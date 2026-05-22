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
import { requireCustomerSession } from "@/lib/customer-jwt";
import { attributeOrderToCampaign } from "@/lib/push/attribution";

function normalisePhoneForLookup(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

// GET /api/orders?phone=+60123456789 — fetch orders by customer phone.
// Hardened: returns the caller's full order history (totals, items,
// timestamps). Previously open — anyone could enumerate phone numbers
// and read order history. Now requires a customer session and the
// session phone must match the requested phone.
export async function GET(request: NextRequest) {
  const rawPhone = request.nextUrl.searchParams.get("phone");
  if (!rawPhone) return NextResponse.json({ error: "Missing phone" }, { status: 400 });
  const phone = normalisePhoneForLookup(rawPhone);

  const guard = requireCustomerSession(request);
  if (guard.error) return guard.error as unknown as NextResponse;
  if (!guard.session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (guard.session.phone !== phone) {
    return NextResponse.json({ error: "Session does not match phone" }, { status: 403 });
  }

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
      voucherCode: voucherCodeInput,
      voucherId,
      rewardDiscountSen,
      rewardId: rewardIdInput,
      rewardName: rewardNameInput,
      walletVoucherId: walletVoucherIdInput,
      loyaltyPhone,
      loyaltyId,
      clientSupportsSkipPayment,
      pickupAt: pickupAtInput,
    } = body;
    // pickupAt — optional ISO timestamp for scheduled pickup. Null /
    // omitted = brew immediately (ASAP, original behaviour). Stored on
    // the order row so a future KDS scheduler can hold the order out
    // of the brew queue until ~prep-time before pickup.
    const pickupAt = typeof pickupAtInput === "string" && pickupAtInput.length > 0
      ? pickupAtInput
      : null;
    // walletVoucherId / rewardId / rewardName / voucherCode are mutable
    // because the non-stackable-tier exclusivity path below may decide
    // to drop the voucher in favour of the bigger tier discount. We
    // initialise from the request, then narrow before the order
    // insert so the row records what actually applied, not what the
    // customer hopefully picked.
    let walletVoucherId: string | null = walletVoucherIdInput ?? null;
    let rewardId:        string | null = rewardIdInput ?? null;
    let rewardName:      string | null = rewardNameInput ?? null;
    let voucherCode:     string | null = voucherCodeInput ?? null;

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
        .select("store_id, is_active, is_open")
        .eq("store_id", storeId)
        .maybeSingle();
      if (!outletRow || outletRow.is_active === false) {
        return NextResponse.json({ error: "Outlet is not accepting orders" }, { status: 400 });
      }
      // is_open is the manual "we're closed right now" toggle the
      // backoffice flips from /pickup/settings. Separate from is_active.
      if (outletRow.is_open === false) {
        return NextResponse.json(
          { error: "Outlet is currently closed for orders" },
          { status: 400 },
        );
      }
    }

    // Pull configurable settings — admin can edit these from backoffice
    // without redeploying. Falls back to safe defaults if missing.
    const { data: settingsRows } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["points_per_rm", "min_order_value", "sst"]);
    const settingsMap = new Map((settingsRows ?? []).map((r) => [r.key, r.value]));
    const pointsPerRm  = Number((settingsMap.get("points_per_rm") as any)?.rate ?? 1);
    const minOrderRm   = Number((settingsMap.get("min_order_value") as any)?.rm ?? 0);

    // First-order discount — config moved into the Discount Engine
    // (promotions table) so all checkout discounts live in one place.
    // Reads the most recent active row with trigger_type='first_order'.
    // Falls back to disabled when nothing's configured.
    const { data: fodRow } = await supabase
      .from("promotions")
      .select("discount_type, discount_value, is_active")
      .eq("brand_id", "brand-celsius")
      .eq("trigger_type", "first_order")
      .eq("is_active", true)
      .order("priority", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fodConfig = fodRow
      ? {
          enabled: true,
          type: (fodRow.discount_type as string) === "percentage_off" ? "percent" : "fixed",
          amount: Number(fodRow.discount_value ?? 0),
        }
      : undefined;
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
    let   voucherDiscountSen = Math.round(discountSen ?? 0);

    // Server-side reward validation + bound. Was: trust the client's
    // rewardDiscountSen blindly. A stale or malicious client could
    // claim a discount on an expired / inactive / out-of-stock reward,
    // or claim a value larger than the cart subtotal.
    let rewardDiscountSenAmt = 0;
    if (walletVoucherId) {
      // Wallet voucher path — pull the full applicability rule so we
      // can verify the discount server-side. Earlier the route just
      // capped the client's rewardDiscountSen at subtotal, which let a
      // crafted client claim a "Free Drink" voucher on a cake-only
      // cart. Now we recompute the eligible discount from the cart +
      // voucher rule and cap the client's claim at that.
      const { data: voucher } = await supabase
        .from("issued_rewards")
        .select(`
          id, member_id, status, expires_at, min_order_value,
          discount_type, discount_value,
          applicable_categories, applicable_products, free_product_name
        `)
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

      const cats  = (voucher.applicable_categories as string[] | null) ?? null;
      const prods = (voucher.applicable_products as string[] | null) ?? null;
      const hasFilter = (cats && cats.length > 0) || (prods && prods.length > 0);

      // Build a lite cart-line shape locally. The full cartLines used
      // by evaluatePromotions is constructed further down (after the
      // tier lookup) so we can't reuse it here.
      type CartLineLite = { product_id: string; quantity: number; unit_price: number };
      const localLines: CartLineLite[] = (items as Array<{
        product?: { id?: string };
        productId?: string;
        product_id?: string;
        quantity: number;
        basePrice?: number;
        totalPrice?: number;
      }>).map((i) => {
        const pid = i.product?.id ?? i.productId ?? i.product_id ?? "";
        const unit = i.basePrice != null
          ? i.basePrice
          : (i.totalPrice ?? 0) / Math.max(1, i.quantity);
        return { product_id: pid, quantity: i.quantity, unit_price: unit };
      });

      // When the voucher has no category/product filter every cart
      // line is eligible. Otherwise look up product → category from
      // the products table to enforce server-authoritatively.
      let eligibleLines: CartLineLite[] = localLines;
      if (hasFilter) {
        const productIds = Array.from(new Set(
          localLines.map((l) => l.product_id).filter((id): id is string => !!id),
        ));
        const categoryByProductId = new Map<string, string | null>();
        if (productIds.length > 0) {
          const { data: prodRows } = await supabase
            .from("products")
            .select("id, category")
            .in("id", productIds);
          for (const p of ((prodRows ?? []) as Array<{ id: string; category: string | null }>)) {
            categoryByProductId.set(p.id, p.category);
          }
        }
        eligibleLines = localLines.filter((l) => {
          if (prods && prods.length > 0 && prods.includes(l.product_id)) return true;
          if (cats && cats.length > 0) {
            const cat = categoryByProductId.get(l.product_id);
            if (cat && cats.includes(cat)) return true;
          }
          return false;
        });
      }

      // Server-recompute the discount based on the voucher's
      // discount_type + the eligible cart slice. If the customer
      // claimed more than this, we silently cap them — the order
      // proceeds, the wallet voucher still gets consumed, but they
      // only get what they were entitled to. Catches both honest
      // client bugs and dishonest client tampering.
      const dt = voucher.discount_type as string | null;
      const dv = (voucher.discount_value as number | null) ?? 0;
      let serverDiscountSen = 0;
      if (eligibleLines.length > 0) {
        const eligibleSubSen = Math.round(
          eligibleLines.reduce((s, l) => s + l.unit_price * l.quantity, 0) * 100,
        );
        if (dt === "free_item" || dt === "free_upgrade") {
          // Free item covers the cheapest eligible line's unit price.
          // Modifier upgrades on top still cost — we only zero out the
          // base price which lives on the cart line as unit_price.
          serverDiscountSen = Math.round(
            Math.min(...eligibleLines.map((l) => l.unit_price)) * 100,
          );
        } else if (dt === "percent") {
          serverDiscountSen = Math.round(eligibleSubSen * (dv / 100));
        } else if (dt === "flat") {
          // discount_value stored in sen for flat type.
          serverDiscountSen = Math.min(Math.round(dv), eligibleSubSen);
        } else if (dt === "fixed_amount") {
          // discount_value stored in RM for fixed_amount type.
          serverDiscountSen = Math.min(Math.round(dv * 100), eligibleSubSen);
        }
      }

      rewardDiscountSenAmt = Math.max(0, Math.min(rewardDiscountSen ?? 0, serverDiscountSen));
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
    let memberTierStackable = true;
    if (loyaltyId) {
      const { data: mb } = await supabase
        .from("member_brands")
        .select("current_tier_id, tiers(stackable)")
        .eq("member_id", loyaltyId)
        .eq("brand_id", "brand-celsius")
        .single();
      memberTierId = (mb as { current_tier_id?: string | null } | null)?.current_tier_id ?? null;
      const tierRow = (mb as { tiers?: { stackable?: boolean | null } | null } | null)?.tiers;
      memberTierStackable = (tierRow?.stackable as boolean | null) ?? true;
    }

    type IncomingItem = {
      product?: { id?: string; name?: string };
      productId?: string;
      product_id?: string;
      quantity: number;
      basePrice?: number;
      totalPrice?: number;
    };
    const cartLinesBare = (items as IncomingItem[]).map((i) => {
      const pid = i.product?.id ?? i.productId ?? i.product_id ?? "";
      const unit = i.basePrice != null
        ? i.basePrice
        : (i.totalPrice ?? 0) / Math.max(1, i.quantity);
      return { product_id: pid, quantity: i.quantity, unit_price: unit };
    });
    // Batch-look-up product categories so the loyalty evaluator can
    // honor category-gated combos ("any classic drink + any roti
    // bakar — RM2 off"). Without this the gate fails closed and the
    // combo silently never triggers. Lookup is server-side so the
    // client can't spoof a category to claim a combo it shouldn't.
    const productIdsForCategory = Array.from(
      new Set(cartLinesBare.map((l) => l.product_id).filter(Boolean)),
    );
    const categoryByProductId = new Map<string, string | null>();
    if (productIdsForCategory.length > 0) {
      const { data: catRows } = await supabase
        .from("products")
        .select("id, category")
        .in("id", productIdsForCategory);
      for (const p of ((catRows ?? []) as Array<{ id: string; category: string | null }>)) {
        categoryByProductId.set(p.id, p.category);
      }
    }
    const cartLines: CartLine[] = cartLinesBare.map((l) => ({
      ...l,
      category: categoryByProductId.get(l.product_id) ?? undefined,
    }));
    const evaluated = await evaluatePromotions({
      lines: cartLines,
      member_id: loyaltyId,
      outlet_id: selectedStore.id,
      member_tier_id: memberTierId,
    });

    // Non-stackable tier exclusivity (Staff, Black Card). The flat
    // tier % trades stacking for a higher rate, so a wallet voucher
    // and the tier perk shouldn't BOTH discount the same order. Pick
    // whichever saves more:
    //   • voucher wins → drop the tier perk from evaluated
    //   • tier wins    → drop the voucher (don't burn it; null out
    //                    walletVoucherId + zero the wallet voucher /
    //                    reward / FOD legs so the order route doesn't
    //                    mark the voucher consumed)
    // Stackable tiers (Member / Silver / Gold / Platinum) skip this
    // entirely and just layer both — same as before.
    const round2cents = (n: number) => Math.round(n * 100) / 100;
    if (memberTierId && !memberTierStackable) {
      const tierPerk = evaluated.discounts.find((d) => d.reason === "tier_perk");
      const tierPerkSen = Math.round((tierPerk?.discount_amount ?? 0) * 100);
      const externalSen = voucherDiscountSen + rewardDiscountSenAmt + fodDiscountSen;
      if (externalSen >= tierPerkSen && tierPerk) {
        // Voucher / reward / FOD beats the tier perk — drop the tier
        // perk from the evaluated discount list.
        evaluated.discounts = evaluated.discounts.filter(
          (d) => d.reason !== "tier_perk",
        );
        evaluated.total_discount = round2cents(
          evaluated.total_discount - (tierPerk.discount_amount ?? 0),
        );
        evaluated.total = round2cents(evaluated.subtotal - evaluated.total_discount);
      } else if (tierPerkSen > 0 && externalSen > 0) {
        // Tier perk wins — drop the voucher / reward / FOD so it stays
        // available for a future order. walletVoucherId is nulled so
        // applyOrderV2Hooks doesn't mark the voucher used; the
        // rewardId / rewardName / voucherCode fields are nulled so
        // the order row + receipt don't render a phantom "Reward · X"
        // line for a discount that never actually applied.
        voucherDiscountSen = 0;
        rewardDiscountSenAmt = 0;
        fodDiscountSen = 0;
        walletVoucherId = null;
        rewardId = null;
        rewardName = null;
        voucherCode = null;
      }
    }

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
        pickup_at:              pickupAt,
      } as Record<string, unknown>)
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

    // Notification → order attribution. Tag the most recent
    // unattributed push send for this member (within 24h) with this
    // order so the backoffice campaign stats can show "orders driven"
    // per campaign. Fire-and-forget; never blocks the response.
    void attributeOrderToCampaign({
      orderId:   order.id,
      memberId:  loyaltyId ?? null,
      revenueRm: totalSen / 100,
    });

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
