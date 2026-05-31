import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireMinAppVersion } from "@/lib/min-app-version";
import type { OrderRow } from "@/lib/supabase/types";
import {
  checkRateLimit,
  RATE_LIMITS,
  computeVoucherDiscount,
  type VoucherDiscountSpec,
  type DiscountCartLine,
} from "@celsius/shared";
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

/** The canonical discount-mechanics columns on voucher_templates — the
 *  full set the shared engine needs to compute any of the 9 types. */
const DISCOUNT_SPEC_COLUMNS =
  "discount_type, discount_value, max_discount_value, min_order_value, " +
  "applicable_categories, applicable_products, free_product_ids, free_product_name, " +
  "bogo_buy_qty, bogo_free_qty, combo_price_sen, override_price_sen";

type DiscountSpecRow = {
  discount_type: string | null;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  combo_price_sen: number | null;
  override_price_sen: number | null;
};

/** Build the sen-based engine spec from a voucher_templates row. Mixed
 *  units on the row: discount_value(flat)/max_discount_value/
 *  combo_price_sen/override_price_sen are SEN; min_order_value is RM;
 *  discount_value(percent) is a raw percentage. */
function rowToDiscountSpec(t: DiscountSpecRow): VoucherDiscountSpec {
  return {
    discount_type: (t.discount_type as VoucherDiscountSpec["discount_type"]) ?? null,
    discount_value: t.discount_value,
    max_discount_value_sen: t.max_discount_value,
    min_order_value_sen: t.min_order_value != null ? Math.round(t.min_order_value * 100) : null,
    applicable_categories: t.applicable_categories,
    applicable_products: t.applicable_products,
    free_product_ids: t.free_product_ids,
    free_product_name: t.free_product_name,
    bogo_buy_qty: t.bogo_buy_qty,
    bogo_free_qty: t.bogo_free_qty,
    combo_price_sen: t.combo_price_sen,
    override_price_sen: t.override_price_sen,
  };
}

type RawOrderItem = {
  product?: { id?: string; name?: string };
  productId?: string;
  product_id?: string;
  quantity: number;
  basePrice?: number;
  totalPrice?: number;
};

/** Build sen-based engine cart lines from incoming order items.
 *  unit_price_sen uses the BASE price (modifier upcharges stay paid —
 *  matches the established "free drink covers the base only" rule);
 *  modifier_total_sen carries the upcharge so free_upgrade can free the
 *  add-on. Resolves each line's category from the products table only
 *  when the spec filters by category (product filters match on id). */
async function buildEngineCart(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  items: unknown,
  resolveCategories: boolean,
): Promise<DiscountCartLine[]> {
  const lines: DiscountCartLine[] = (items as RawOrderItem[]).map((i) => {
    const pid = i.product?.id ?? i.productId ?? i.product_id ?? "";
    const qty = Math.max(1, i.quantity);
    const effRm = (i.totalPrice ?? 0) / qty; // per-unit, incl modifiers
    const unitRm = i.basePrice != null ? i.basePrice : effRm;
    const modRm = i.basePrice != null ? Math.max(0, effRm - i.basePrice) : 0;
    return {
      product_id: pid,
      quantity: qty,
      unit_price_sen: Math.round(unitRm * 100),
      modifier_total_sen: Math.round(modRm * 100),
      category: null,
      category_id: null,
      name: i.product?.name ?? "",
    };
  });
  if (resolveCategories) {
    const ids = Array.from(new Set(lines.map((l) => l.product_id).filter((x): x is string => !!x)));
    if (ids.length) {
      const { data } = await supabase.from("products").select("id, category").in("id", ids);
      const byId = new Map(
        ((data ?? []) as Array<{ id: string; category: string | null }>).map((p) => [p.id, p.category]),
      );
      for (const l of lines) l.category = byId.get(l.product_id) ?? null;
    }
  }
  return lines;
}

/** Server-side reward validation + AUTHORITATIVE discount recompute.
 *  Was: trust the client's `rewardDiscountSen` (clamped to subtotal).
 *  Now: gate the reward (active / window / stock / min-order / points)
 *  AND recompute the discount from the canonical voucher_templates spec
 *  via the shared engine — the client number is never used for money,
 *  so a stale or malicious client can't claim a discount the reward
 *  doesn't grant, and combo/bogo/override_price/free_upgrade actually
 *  apply. */
async function validateAppliedReward(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  args: {
    rewardId: string;
    items: unknown;
    subtotalSen: number;
    minOrderRm: number;
    totalRm: number;
    loyaltyId: string | null;
  },
): Promise<{ ok: true; discountSen: number } | { ok: false; error: string }> {
  // Cleanup: catalog validation reads voucher_templates (the canonical
  // source) by legacy_reward_id, not the rewards table. points_cost is
  // the template's name for points_required.
  const { data: reward } = await supabase
    .from("voucher_templates")
    .select("id, is_active, valid_from, valid_until, stock, points_cost, " + DISCOUNT_SPEC_COLUMNS)
    .eq("legacy_reward_id", args.rewardId)
    .maybeSingle<{
      id: string;
      is_active: boolean | null;
      valid_from: string | null;
      valid_until: string | null;
      stock: number | null;
      points_cost: number | null;
    } & DiscountSpecRow>();

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
  const pointsCost = reward.points_cost ?? 0;
  if (pointsCost > 0 && args.loyaltyId) {
    const { data: voucher } = await supabase
      .from("issued_rewards")
      .select("id")
      .eq("member_id", args.loyaltyId)
      // issued_rewards.reward_id holds the legacy text id, so match on
      // the original args.rewardId — NOT reward.id (now a template UUID).
      .eq("reward_id", args.rewardId)
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

  // Authoritative discount: recompute from the canonical spec via the
  // shared engine — the client's number is never trusted for money, and
  // every type (flat/percent/free_item/free_upgrade/bogo/combo/
  // override_price) is computed the same way the wallet path does.
  const spec = rowToDiscountSpec(reward);
  const cart = await buildEngineCart(
    supabase,
    args.items,
    !!(spec.applicable_categories && spec.applicable_categories.length),
  );
  const result = computeVoucherDiscount({ spec, cart });
  // Final guard against the order subtotal (the engine already bounds at
  // its own line-sum; this re-clamps against the authoritative subtotal).
  const discountSen = Math.max(0, Math.min(args.subtotalSen, result.discount_sen));
  return { ok: true, discountSen };
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
      // rewardDiscountSen (client-claimed) intentionally ignored — the
      // discount is recomputed server-side from the canonical spec.
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

    // pickup_at sanity: must be in the future (clock skew tolerance:
    // -2 min), within 7 days, and fall inside this outlet's opening
    // hours per app_settings.outlet_hours. Defends against a stale
    // client picker, manual API call, or a glitched device clock.
    if (pickupAt) {
      const at = new Date(pickupAt);
      const now = Date.now();
      if (Number.isNaN(at.getTime())) {
        return NextResponse.json({ error: "Invalid pickupAt" }, { status: 400 });
      }
      if (at.getTime() < now - 2 * 60_000) {
        return NextResponse.json({ error: "pickupAt is in the past" }, { status: 400 });
      }
      if (at.getTime() > now + 7 * 24 * 3600_000) {
        return NextResponse.json({ error: "pickupAt is too far in the future" }, { status: 400 });
      }
      const supabase = getSupabaseAdmin();
      const { data: hoursRow } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "outlet_hours")
        .maybeSingle();
      type Hours = { open: string; close: string; daysOpen: number[] };
      const hoursMap = (hoursRow?.value ?? {}) as Record<string, Hours>;
      const oh = hoursMap[selectedStore.id];
      if (oh) {
        const [oh_h, oh_m] = oh.open.split(":").map((n) => parseInt(n, 10));
        const [ch_h, ch_m] = oh.close.split(":").map((n) => parseInt(n, 10));
        const dayOpen  = new Date(at); dayOpen.setHours(oh_h,  oh_m,  0, 0);
        const dayClose = new Date(at); dayClose.setHours(ch_h, ch_m, 0, 0);
        // Past-midnight outlets — close < open means close belongs to
        // the next calendar day.
        const effClose = dayClose.getTime() > dayOpen.getTime()
          ? dayClose
          : new Date(dayClose.getTime() + 24 * 3600_000);
        if (at.getTime() < dayOpen.getTime() || at.getTime() > effClose.getTime()) {
          return NextResponse.json(
            { error: "pickupAt is outside this outlet's opening hours" },
            { status: 400 },
          );
        }
      }
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
      // Wallet voucher path — load + validate the voucher, then defer
      // the actual discount math to @celsius/shared's
      // computeVoucherDiscount so POS and Pickup never drift on the
      // arithmetic.
      const { data: voucher } = await supabase
        .from("issued_rewards")
        .select(`
          id, member_id, status, expires_at, voucher_template_id, min_order_value,
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

      // Canonical spec: prefer the voucher's voucher_template (it carries
      // max_discount_value, free_product_ids, and the bogo/combo/override
      // knobs that issued_rewards doesn't). Fall back to the issued_rewards
      // inline columns for legacy vouchers minted before the template link.
      const templateId = (voucher as { voucher_template_id?: string | null }).voucher_template_id ?? null;
      const { data: tmpl } = templateId
        ? await supabase
            .from("voucher_templates")
            .select(DISCOUNT_SPEC_COLUMNS)
            .eq("id", templateId)
            .maybeSingle<DiscountSpecRow>()
        : { data: null };
      const spec: VoucherDiscountSpec = tmpl
        ? rowToDiscountSpec(tmpl)
        : {
            discount_type: (voucher.discount_type as VoucherDiscountSpec["discount_type"]) ?? null,
            discount_value: (voucher.discount_value as number | null) ?? null,
            max_discount_value_sen: null,
            min_order_value_sen: voucher.min_order_value != null
              ? Math.round((voucher.min_order_value as number) * 100)
              : null,
            applicable_categories: (voucher.applicable_categories as string[] | null) ?? null,
            applicable_products: (voucher.applicable_products as string[] | null) ?? null,
            free_product_ids: null,
            free_product_name: (voucher.free_product_name as string | null) ?? null,
            bogo_buy_qty: null,
            bogo_free_qty: null,
            combo_price_sen: null,
            override_price_sen: null,
          };

      // unit_price_sen uses base price (modifiers stay paid); category
      // resolved only when the spec filters by category.
      const cart = await buildEngineCart(
        supabase,
        items,
        !!(spec.applicable_categories && spec.applicable_categories.length),
      );
      const result = computeVoucherDiscount({ spec, cart });

      // Translate engine reasons → user-facing 400 messages where
      // they're customer-actionable (preserves the previous
      // behaviour). Other reasons silently cap to 0 so the order
      // still proceeds — the wallet voucher gets consumed but the
      // customer only gets what they were entitled to.
      if (result.reason === "below_min_order") {
        return NextResponse.json({ error: "Minimum order not met for voucher" }, { status: 400 });
      }

      // Authoritative: use the engine's value directly (bounded by the
      // order subtotal), NOT min(client, engine). The client number is a
      // preview only — trusting it would cap newly-supported types
      // (combo/override_price/free_upgrade) at the client's stale 0.
      rewardDiscountSenAmt = Math.max(0, Math.min(subtotalSen, result.discount_sen));
    } else if (rewardId) {
      const validated = await validateAppliedReward(supabase, {
        rewardId,
        items,
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
