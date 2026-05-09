import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { OrderRow } from "@/lib/supabase/types";
import { checkRateLimit, RATE_LIMITS } from "@celsius/shared";
import { getTierMultiplier } from "@/lib/loyalty/points";
import {
  evaluatePromotions,
  recordPromotionApplications,
  type CartLine,
} from "@/lib/loyalty/promotions";

// GET /api/orders?phone=+60123456789 — fetch orders by customer phone
export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("customer_phone", phone)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

function generateOrderNumber(): string {
  return `C-${String(Math.floor(Math.random() * 9999)).padStart(4, "0")}`;
}

/** Server-side reward validation + price recompute. Was: trust the
 *  client's `rewardDiscountSen`. Now: fetch the reward, gate it on
 *  is_active / valid_until / stock, and bound the discount at the
 *  cart subtotal so a malicious or stale client can't drain the
 *  order to RM0. Full client/server discount-math parity is a
 *  separate refactor; for now we trust the client's number IF it
 *  passes these gates. */
async function validateAppliedReward(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  args: {
    rewardId: string;
    rewardDiscountSen: number;
    subtotalSen: number;
    minOrderRm: number;
    totalRm: number;
  },
): Promise<{ ok: true; discountSen: number } | { ok: false; error: string }> {
  const { data: reward } = await supabase
    .from("rewards")
    .select("id, is_active, valid_from, valid_until, stock, min_order_value")
    .eq("id", args.rewardId)
    .single<{
      id: string;
      is_active: boolean | null;
      valid_from: string | null;
      valid_until: string | null;
      stock: number | null;
      min_order_value: number | null;
    }>();

  if (!reward) {
    return { ok: false, error: "Reward no longer available" };
  }
  if (!reward.is_active) {
    return { ok: false, error: "Reward is no longer active" };
  }
  const now = Date.now();
  if (reward.valid_from && new Date(reward.valid_from).getTime() > now) {
    return { ok: false, error: "Reward not yet active" };
  }
  if (reward.valid_until && new Date(reward.valid_until).getTime() < now) {
    return { ok: false, error: "Reward has expired" };
  }
  if (reward.stock != null && reward.stock <= 0) {
    return { ok: false, error: "Reward is out of stock" };
  }
  if (reward.min_order_value != null && args.totalRm < reward.min_order_value) {
    return {
      ok: false,
      error: `Reward needs a minimum order of RM${reward.min_order_value.toFixed(2)}`,
    };
  }

  // Sanity-bound the client-supplied discount: never negative,
  // never larger than the cart subtotal.
  const clamped = Math.max(0, Math.min(args.subtotalSen, Math.round(args.rewardDiscountSen ?? 0)));
  return { ok: true, discountSen: clamped };
}

export async function POST(request: NextRequest) {
  // Rate limit by IP — without this an attacker can script the
  // endpoint to flood the orders table + Stripe with fake intents.
  // RATE_LIMITS.ORDER_CREATE is 10/min per identifier.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rate = await checkRateLimit(ip, RATE_LIMITS.ORDER_CREATE);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many order attempts. Try again in a minute." },
      {
        status: 429,
        headers: rate.retryAfter
          ? { "Retry-After": String(rate.retryAfter) }
          : undefined,
      },
    );
  }

  try {
    const body = await request.json();
    const {
      items,
      selectedStore,
      paymentMethod,
      total,
      sst,
      discountSen,
      voucherCode,
      voucherId,
      rewardDiscountSen,
      rewardId,
      rewardName,
      loyaltyPhone,
      loyaltyId,
      promoCode,
    } = body;

    if (!items?.length || !selectedStore || !paymentMethod) {
      return NextResponse.json({ error: "Invalid order data" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Pull configurable settings — admin can edit these from backoffice
    // without redeploying. Falls back to safe defaults if missing.
    const { data: settingsRows } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["points_per_rm", "min_order_value", "first_order_discount"]);
    const settingsMap = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
    const pointsPerRm  = Number((settingsMap.get("points_per_rm") as any)?.rate ?? 1);
    const minOrderRm   = Number((settingsMap.get("min_order_value") as any)?.rm ?? 0);
    const fodConfig    = settingsMap.get("first_order_discount") as
      { enabled: boolean; type: "percent" | "fixed"; amount: number } | undefined;

    if (minOrderRm > 0 && total < minOrderRm) {
      return NextResponse.json(
        { error: `Minimum order is RM${minOrderRm.toFixed(2)}` },
        { status: 400 }
      );
    }

    // Server-side voucher validation: check active, not expired, not over max_uses
    if (voucherId) {
      const { data: voucher } = await supabase
        .from("vouchers")
        .select("id, is_active, expires_at, max_uses, used_count")
        .eq("id", voucherId)
        .single();

      if (!voucher || !voucher.is_active) {
        return NextResponse.json({ error: "Voucher is no longer valid" }, { status: 400 });
      }
      if (voucher.expires_at && new Date(voucher.expires_at) < new Date()) {
        return NextResponse.json({ error: "Voucher has expired" }, { status: 400 });
      }
      if (voucher.max_uses != null && voucher.used_count >= voucher.max_uses) {
        return NextResponse.json({ error: "Voucher usage limit reached" }, { status: 400 });
      }
    }

    const orderNumber        = generateOrderNumber();
    const subtotalSen        = Math.round(total * 100);
    const voucherDiscountSen = Math.round(discountSen ?? 0);

    // Server-side reward validation + bound. Was: trust the client's
    // rewardDiscountSen blindly. A stale or malicious client could
    // claim a discount on an expired / inactive / out-of-stock reward,
    // or claim a value larger than the cart subtotal.
    let rewardDiscountSenAmt = 0;
    if (rewardId) {
      const validated = await validateAppliedReward(supabase, {
        rewardId,
        rewardDiscountSen,
        subtotalSen,
        minOrderRm,
        totalRm: total,
      });
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      rewardDiscountSenAmt = validated.discountSen;
    }

    // First-order discount: server validates independently — checks the orders
    // table for prior completed orders on this phone.
    let fodDiscountSen = 0;
    if (fodConfig?.enabled && loyaltyPhone) {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("loyalty_phone", loyaltyPhone)
        .in("status", ["completed", "preparing", "ready", "paid"]);
      if ((count ?? 0) === 0) {
        fodDiscountSen = fodConfig.type === "percent"
          ? Math.round(subtotalSen * (fodConfig.amount / 100))
          : Math.round(fodConfig.amount * 100);
      }
    }

    // Promotion engine: auto, code, tier-perk, reward-link discounts.
    let memberTierId: string | null = null;
    if (loyaltyId) {
      const { data: mb } = await supabase
        .from("member_brands")
        .select("current_tier_id")
        .eq("member_id", loyaltyId)
        .eq("brand_id", "brand-celsius")
        .single();
      memberTierId = (mb as { current_tier_id?: string | null } | null)?.current_tier_id ?? null;
    }

    type IncomingItem = {
      product?: { id?: string; name?: string };
      productId?: string;
      product_id?: string;
      quantity: number;
      basePrice?: number;
      totalPrice?: number;
    };
    const cartLines: CartLine[] = (items as IncomingItem[]).map((i) => {
      const pid = i.product?.id ?? i.productId ?? i.product_id ?? "";
      const unit = i.basePrice != null
        ? i.basePrice
        : (i.totalPrice ?? 0) / Math.max(1, i.quantity);
      return { product_id: pid, quantity: i.quantity, unit_price: unit };
    });
    const evaluated = await evaluatePromotions({
      lines: cartLines,
      member_id: loyaltyId,
      outlet_id: selectedStore.id,
      member_tier_id: memberTierId,
      promo_code: promoCode ?? null,
    });
    const promoDiscountSen = Math.round(evaluated.total_discount * 100);

    const totalDiscountSen   = voucherDiscountSen + rewardDiscountSenAmt + fodDiscountSen + promoDiscountSen;
    const afterDiscount      = Math.max(0, subtotalSen - totalDiscountSen);
    const sstSen             = Math.round(sst != null ? sst * 100 : afterDiscount * 0.06);
    const totalSen           = afterDiscount + sstSen;

    // Points = pointsPerRm × RM of after-discount subtotal × tier multiplier.
    // Coupon multiplier (post-purchase) is applied at earn-time inside
    // earnLoyaltyPoints since it can change between create and pay.
    const basePoints   = loyaltyId ? Math.floor((afterDiscount / 100) * pointsPerRm) : 0;
    const tierMul      = loyaltyId ? await getTierMultiplier(loyaltyId) : 1;
    const pointsToEarn = Math.round(basePoints * tierMul);

    const { data, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_number:           orderNumber,
        store_id:               selectedStore.id,
        status:                 "pending",
        payment_method:         paymentMethod,
        subtotal:               subtotalSen,
        discount_amount:        voucherDiscountSen,
        voucher_code:           voucherCode ?? null,
        reward_discount_amount: rewardDiscountSenAmt,
        reward_id:              rewardId ?? null,
        reward_name:            rewardName ?? null,
        sst_amount:             sstSen,
        first_order_discount_amount: fodDiscountSen,
        total:                  totalSen,
        customer_phone:         loyaltyPhone ?? null,
        loyalty_phone:          loyaltyPhone ?? null,
        loyalty_id:             loyaltyId ?? null,
        loyalty_points_earned:  pointsToEarn,
      })
      .select()
      .single();

    if (orderError || !data) {
      console.error("Order insert error:", orderError);
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    const order = data as OrderRow;

    // Normalises both call shapes the order endpoint receives:
    //   PWA  : { product: { id, name }, modifiers: { selections: [...], specialInstructions } }
    //   Native: { productId, name,        modifiers: [...],            specialInstructions }
    type AnyItem = {
      product?:    { id?: string; name?: string };
      productId?:  string;
      name?:       string;
      modifiers?:  unknown;
      specialInstructions?: string;
      quantity:    number;
      totalPrice:  number;
    };
    const orderItems = (items as AnyItem[]).map((item) => {
      const productId   = item.product?.id ?? item.productId ?? "";
      const productName = item.product?.name ?? item.name ?? "";
      let selections:    Array<Record<string, unknown>> = [];
      let specialInstructions: string | undefined;
      if (Array.isArray(item.modifiers)) {
        selections = item.modifiers as Array<Record<string, unknown>>;
        specialInstructions = item.specialInstructions;
      } else if (item.modifiers && typeof item.modifiers === "object") {
        const m = item.modifiers as { selections?: Array<Record<string, unknown>>; specialInstructions?: string };
        selections = m.selections ?? [];
        specialInstructions = m.specialInstructions ?? item.specialInstructions;
      } else {
        specialInstructions = item.specialInstructions;
      }
      return {
        order_id:     order.id,
        product_id:   productId,
        product_name: productName,
        variant_name: null,
        unit_price:   Math.round((item.totalPrice / item.quantity) * 100),
        quantity:     item.quantity,
        item_total:   Math.round(item.totalPrice * 100),
        modifiers:    { selections, specialInstructions },
      };
    });

    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
    if (itemsError) console.error("Order items error:", itemsError);

    // Increment voucher used_count atomically via RPC
    if (voucherId) {
      await supabase.rpc("increment_voucher_count", { voucher_id: voucherId });
    }

    // Reward-points deduction has moved to the payment-success
    // webhooks (apps/order/src/app/api/payments/stripe/webhook and
    // /api/payments/webhook for Revenue Monster). Calling it here
    // would double-deduct, AND would burn points on orders the
    // customer abandons before paying — both are wrong. The webhook
    // gates on `status="pending" → "preparing"` so it's idempotent
    // even if Stripe fires the event twice.

    // Record applied promotions to the loyalty ledger — awaited for
    // the same reason. uses_count never bumping = customer can re-
    // claim the same code-driven promo.
    try {
      await recordPromotionApplications({
        evaluated,
        member_id: loyaltyId ?? null,
        outlet_id: selectedStore.id,
        reference_id: order.id,
        lines: cartLines,
        member_tier_id: memberTierId,
        promo_code: promoCode ?? null,
      });
    } catch (err) {
      console.error(
        `[loyalty] FAILED to record promo applications for order=${order.id} — RECONCILE MANUALLY`,
        err,
      );
    }

    return NextResponse.json({
      orderId:     order.id,
      orderNumber: order.order_number,
      status:      order.status,
      totalSen,
    });
  } catch (err) {
    console.error("Create order error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
