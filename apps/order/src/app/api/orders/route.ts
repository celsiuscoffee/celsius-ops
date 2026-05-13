import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireMinAppVersion } from "@/lib/min-app-version";
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
    loyaltyId: string | null;
  },
): Promise<{ ok: true; discountSen: number } | { ok: false; error: string }> {
  const { data: reward } = await supabase
    .from("rewards")
    .select("id, is_active, valid_from, valid_until, stock, min_order_value, points_required")
    .eq("id", args.rewardId)
    .single<{
      id: string;
      is_active: boolean | null;
      valid_from: string | null;
      valid_until: string | null;
      stock: number | null;
      min_order_value: number | null;
      points_required: number | null;
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

  // Pre-check the points balance for catalog rewards. Without this,
  // the customer's order proceeds to a Stripe charge before the
  // post-payment `deductLoyaltyPoints` discovers the shortfall and
  // logs RECONCILE MANUALLY — i.e. they pay the discounted amount
  // but the reward never gets consumed. Skip the check when the
  // member already holds an active issued_reward row for this
  // reward (auto-issued vouchers don't deduct from points balance).
  const pointsCost = reward.points_required ?? 0;
  if (pointsCost > 0 && args.loyaltyId) {
    const { data: voucher } = await supabase
      .from("issued_rewards")
      .select("id")
      .eq("member_id", args.loyaltyId)
      .eq("reward_id", reward.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!voucher) {
      const { data: mb } = await supabase
        .from("member_brands")
        .select("points_balance")
        .eq("member_id", args.loyaltyId)
        .eq("brand_id", "brand-celsius")
        .single<{ points_balance: number }>();
      const balance = mb?.points_balance ?? 0;
      if (balance < pointsCost) {
        return {
          ok: false,
          error: `Not enough points (need ${pointsCost}, have ${balance})`,
        };
      }
    }
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
      walletVoucherId,
      loyaltyPhone,
      loyaltyId,
      clientSupportsSkipPayment,
    } = body;

    if (!items?.length || !selectedStore || !paymentMethod) {
      return NextResponse.json({ error: "Invalid order data" }, { status: 400 });
    }

    // Quantity bounds — without these, a negative qty makes the order
    // total negative (and bypasses the `total <= 0` rate-limit check
    // by being non-positive), and an unbounded qty lets one customer
    // submit a 10000-cup order that clutters the kitchen and the
    // orders table even if Stripe later rejects.
    const MAX_QTY_PER_LINE = 50;
    const MAX_LINES        = 30;
    if (items.length > MAX_LINES) {
      return NextResponse.json({ error: "Too many cart lines" }, { status: 400 });
    }
    for (const it of items as Array<{ quantity?: unknown }>) {
      const q = Number(it?.quantity);
      if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1 || q > MAX_QTY_PER_LINE) {
        return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });
      }
    }

    // Reject sub-min builds when forceUpdate is on (PWA + headerless
    // clients still pass through — see lib/min-app-version.ts).
    {
      const blocked = await requireMinAppVersion(request);
      if (blocked) return blocked;
    }

    const supabase = getSupabaseAdmin();

    // Maintenance mode — server-authoritative. Previously gated only
    // client-side, so a stale or bypassed client could still create
    // orders during a maintenance window. Refuse here too. Error
    // surfaces the configured message so customers see a coherent
    // explanation rather than a generic 503.
    {
      const { data: maint } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "maintenance")
        .maybeSingle();
      const m = (maint?.value ?? null) as { enabled?: boolean; message?: string } | null;
      if (m?.enabled === true) {
        return NextResponse.json(
          { error: m.message?.trim() || "Online ordering is paused for maintenance. Please try again shortly." },
          { status: 503 },
        );
      }
    }

    // Outlet must exist and be active. Without this, an attacker (or
    // a stale client) can drop orders at any string store_id —
    // points still credit, but the staff KDS for that "outlet" never
    // shows it because the row references nothing real.
    const storeId = String(selectedStore?.id ?? "");
    if (!storeId) {
      return NextResponse.json({ error: "Missing outlet" }, { status: 400 });
    }
    {
      const { data: outletRow } = await supabase
        .from("outlet_settings")
        .select("store_id, is_active")
        .eq("store_id", storeId)
        .maybeSingle();
      if (!outletRow || outletRow.is_active === false) {
        return NextResponse.json({ error: "Outlet is not accepting orders" }, { status: 400 });
      }
    }

    // Pull configurable settings — admin can edit these from backoffice
    // without redeploying. Falls back to safe defaults if missing.
    const { data: settingsRows } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["points_per_rm", "min_order_value", "first_order_discount", "sst"]);
    const settingsMap = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
    const pointsPerRm  = Number((settingsMap.get("points_per_rm") as any)?.rate ?? 1);
    const minOrderRm   = Number((settingsMap.get("min_order_value") as any)?.rm ?? 0);
    const fodConfig    = settingsMap.get("first_order_discount") as
      { enabled: boolean; type: "percent" | "fixed"; amount: number } | undefined;
    // SST is server-authoritative — we never trust the client-supplied
    // `sst` because (a) the pickup-native client doesn't send it and
    // (b) honoring it would let a stale or malicious client zero out
    // tax on an order whose backoffice setting still has it enabled.
    const sstConfig    = (settingsMap.get("sst") as { rate?: number; enabled?: boolean } | undefined) ?? { rate: 0.06, enabled: true };
    const sstRate      = sstConfig.enabled === false ? 0 : Number(sstConfig.rate ?? 0.06);

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
    if (walletVoucherId) {
      // Wallet voucher path — different table (issued_rewards).
      const { data: voucher } = await supabase
        .from("issued_rewards")
        .select("id, member_id, status, expires_at, min_order_value")
        .eq("id", walletVoucherId)
        .single();
      if (!voucher || voucher.member_id !== loyaltyId) {
        return NextResponse.json({ error: "Voucher not found" }, { status: 400 });
      }
      if (voucher.status !== "active") {
        return NextResponse.json({ error: "Voucher already used or inactive" }, { status: 400 });
      }
      if (voucher.expires_at && new Date(voucher.expires_at as string) < new Date()) {
        return NextResponse.json({ error: "Voucher expired" }, { status: 400 });
      }
      if (voucher.min_order_value && subtotalSen < ((voucher.min_order_value as number) * 100)) {
        return NextResponse.json({ error: "Minimum order not met for voucher" }, { status: 400 });
      }
      // Trust the client's rewardDiscountSen but cap at subtotal.
      rewardDiscountSenAmt = Math.max(0, Math.min(rewardDiscountSen ?? 0, subtotalSen));
    } else if (rewardId) {
      const validated = await validateAppliedReward(supabase, {
        rewardId,
        rewardDiscountSen,
        subtotalSen,
        minOrderRm,
        totalRm: total,
        loyaltyId: loyaltyId ?? null,
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

    // Promotion engine: auto, tier-perk, reward-link discounts.
    // (Customer-typed promo codes were removed end-to-end.)
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
    });
    const promoDiscountSen = Math.round(evaluated.total_discount * 100);

    const totalDiscountSen   = voucherDiscountSen + rewardDiscountSenAmt + fodDiscountSen + promoDiscountSen;
    const afterDiscount      = Math.max(0, subtotalSen - totalDiscountSen);
    // Server-authoritative SST. Ignores the client-supplied `sst` —
    // the backoffice toggle in app_settings.sst.enabled is the only
    // source of truth. When disabled, sstRate = 0 so sstSen = 0.
    const sstSen             = Math.round(afterDiscount * sstRate);
    const totalSen           = afterDiscount + sstSen;
    void sst; // accepted in payload for backward-compat but intentionally unused

    // Old-client guard: if a free-drink reward fully covers the order, the
    // server bypasses Stripe and returns {skipPayment:true} from
    // create-payment-intent. Old binaries don't understand that response and
    // throw "no clientSecret" — but only AFTER they've already created the
    // order, leaving phantoms in "pending"/"preparing" status. Reject up-
    // front so no order row gets written.
    if (totalSen === 0 && !clientSupportsSkipPayment) {
      return NextResponse.json(
        {
          error:
            "Please update your Celsius app to redeem free-drink rewards. " +
            "Open the App Store / Play Store and install the latest version.",
        },
        { status: 400 },
      );
    }

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
        wallet_voucher_id:      walletVoucherId ?? null,
        sst_amount:             sstSen,
        first_order_discount_amount: fodDiscountSen,
        // Promotion-engine discounts (auto, tier-perk, reward-link)
        // — previously thrown away after computing `afterDiscount`,
        // leaving customers staring at "Total RM 4.72" against an
        // RM 8.90 line item with no idea where the gap went. Persist
        // it so the order detail screen can render the breakdown.
        promo_discount:         promoDiscountSen,
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

    // Record applied promotions to the loyalty ledger — awaited so
    // a failure surfaces in the order POST rather than dropping the
    // uses_count silently.
    try {
      await recordPromotionApplications({
        evaluated,
        member_id: loyaltyId ?? null,
        outlet_id: selectedStore.id,
        reference_id: order.id,
        lines: cartLines,
        member_tier_id: memberTierId,
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
