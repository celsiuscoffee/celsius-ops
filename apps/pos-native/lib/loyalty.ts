import { apiGet, apiPost } from "./api";
import type { CartLine } from "./cart";

/**
 * Loyalty client — native port of the web register's customer/rewards
 * flow (apps/pos/src/lib/customer-lookup.ts + the loyalty API routes).
 *
 * Everything goes through the POS Next.js API (EXPO_PUBLIC_API_BASE),
 * NOT the anon Supabase client — the members/tiers tables are RLS-locked
 * and only the service-role API routes can read them.
 */

export type Tier = {
  id: string;
  slug: string;
  name: string;
  color: string | null;
  multiplier: number | null;
  discount_percent: number | null;
  stackable: boolean | null;
} | null;

export type Member = {
  id: string;
  phone: string;
  name: string | null;
  tags: string[];
  points_balance: number;
  total_spent: number;
  total_visits: number;
  last_visit_at: string | null;
  tier: Tier;
};

export type IssuedVoucher = {
  id: string;
  title: string;
  description: string | null;
  discount_type: string | null;
  discount_value: number | null;
  max_discount_value: number | null;
  free_product_name: string | null;
  icon: string | null;
  source_type: string | null;
  reward_id: string | null;
  expires_at: string | null;
};

export type CatalogReward = IssuedVoucher & { points_required: number };

export type RewardsResponse = {
  balance: number;
  catalog: CatalogReward[];
  issued: IssuedVoucher[];
};

export type UsualItem = {
  id: string;
  name: string;
  price_sen: number;
  image_url: string | null;
  times_ordered: number;
};

export type RedeemDiscount = {
  // flat | percent | free_item | free_upgrade | bogo | combo |
  // override_price | beans_multiplier | none
  type: string | null;
  value: number | null;
  max_discount: number | null;
  min_order: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  // Type-specific knobs (mirror @celsius/shared VoucherDiscountSpec).
  bogo_buy_qty?: number | null;
  bogo_free_qty?: number | null;
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
};

export type RedeemResponse = {
  success: boolean;
  // null in preview mode (catalog reward reserved on the cart; the actual
  // burn + redemption record happen at payment via /api/pos/loyalty/complete).
  redemption_id: string | null;
  points_spent?: number;
  new_balance: number;
  reward_name: string;
  discount: RedeemDiscount;
  preview?: boolean;
};

// ─── API calls ─────────────────────────────────────────────

/**
 * Look up a member by phone — and AUTO-ENROL them if the number isn't
 * found yet (create=1), exactly like the loyalty app. So entering a phone
 * at the register / customer-display never dead-ends on "no member"; a
 * fresh Bronze member row is created and returned.
 */
export async function lookupMember(phone: string): Promise<Member | null> {
  const res = await apiGet<{ member: Member | null }>(
    `/api/pos/loyalty/lookup?phone=${encodeURIComponent(phone)}&create=1`,
  );
  return res.member ?? null;
}

export async function fetchRewards(memberId: string): Promise<RewardsResponse> {
  const res = await apiGet<RewardsResponse>(
    `/api/pos/loyalty/rewards?member_id=${encodeURIComponent(memberId)}`,
  );
  return {
    balance: res.balance ?? 0,
    // Drop points-redemption rows from the wallet view (mirrors the web
    // reward-picker-modal — those are surfaced via the catalog instead).
    issued: (res.issued ?? []).filter((v) => v.source_type !== "points_redemption"),
    catalog: res.catalog ?? [],
  };
}

export async function fetchUsual(memberId: string): Promise<UsualItem[]> {
  try {
    const res = await apiGet<{ usual?: UsualItem[] }>(
      `/api/pos/loyalty/snapshot?member_id=${encodeURIComponent(memberId)}`,
    );
    return res.usual ?? [];
  } catch {
    return [];
  }
}

export async function redeemReward(args: {
  memberId: string;
  rewardId: string | null;
  outletId: string;
  issuedRewardId?: string | null;
  /** Reserve the reward (validate + return the discount) WITHOUT burning Beans
   *  — the burn is deferred to payment (/complete). Catalog rewards honour this;
   *  issued vouchers always commit immediately (they cost no Beans). */
  preview?: boolean;
}): Promise<RedeemResponse> {
  return apiPost<RedeemResponse>("/api/pos/loyalty/redeem", {
    member_id: args.memberId,
    reward_id: args.rewardId,
    outlet_id: args.outletId,
    issued_reward_id: args.issuedRewardId ?? null,
    preview: args.preview ?? false,
  });
}

// ─── Discount engine (ported from @celsius/shared discount-engine) ──
// Not importable here (the workspace package isn't in the Expo module
// graph), so we mirror computeVoucherDiscount's rules exactly: clamp to
// the eligible subtotal, percent honours max cap, free_item = cheapest
// eligible line. Money is sen throughout.

function lineEligible(line: CartLine, d: RedeemDiscount): boolean {
  const hasProducts = (d.applicable_products?.length ?? 0) > 0;
  const hasCats = (d.applicable_categories?.length ?? 0) > 0;
  const hasFreeIds = (d.free_product_ids?.length ?? 0) > 0;
  const hasFreeName = !!d.free_product_name;
  if (!hasProducts && !hasCats && !hasFreeIds && !hasFreeName) return true;
  const pid = line.product.id;
  if (hasFreeIds && d.free_product_ids!.includes(pid)) return true;
  if (hasProducts && d.applicable_products!.includes(pid)) return true;
  if (hasCats && line.product.category && d.applicable_categories!.includes(line.product.category)) return true;
  if (hasFreeName && line.product.name.toLowerCase() === d.free_product_name!.toLowerCase()) return true;
  return false;
}

/** Discount in sen for a redeemed reward against the current cart. */
export function computeRewardDiscount(d: RedeemDiscount, lines: CartLine[]): number {
  if (lines.length === 0 || !d.type) return 0;
  const cartSubtotal = lines.reduce((s, l) => s + l.unit_sen * l.qty, 0);
  if (d.min_order != null && cartSubtotal < d.min_order) return 0;

  const eligible = lines.filter((l) => lineEligible(l, d));
  if (eligible.length === 0) return 0;
  const eligibleSubtotal = eligible.reduce((s, l) => s + l.unit_sen * l.qty, 0);

  let discount = 0;
  switch (d.type) {
    case "flat":
      discount = Math.min(Math.round(d.value ?? 0), eligibleSubtotal);
      break;
    case "percent": {
      let computed = Math.round((eligibleSubtotal * (d.value ?? 0)) / 100);
      if (d.max_discount != null) computed = Math.min(computed, d.max_discount);
      discount = Math.min(computed, eligibleSubtotal);
      break;
    }
    case "free_item": {
      const cheapest = Math.min(...eligible.map((l) => l.unit_sen));
      discount = Number.isFinite(cheapest) ? cheapest : 0;
      break;
    }
    case "free_upgrade": {
      // Free the cheapest eligible line's MODIFIER upcharge (add-on), not
      // the whole line. unit_sen − product.price_sen = the modifier total.
      // Falls back to free_item when no eligible line has modifiers
      // (mirrors the shared engine's migration-safe fallback).
      const upcharges = eligible
        .map((l) => l.unit_sen - l.product.price_sen)
        .filter((m) => m > 0);
      if (upcharges.length) {
        discount = Math.min(...upcharges);
      } else {
        const cheapest = Math.min(...eligible.map((l) => l.unit_sen));
        discount = Number.isFinite(cheapest) ? cheapest : 0;
      }
      break;
    }
    case "bogo": {
      const buyQty = Math.max(1, Math.round(d.bogo_buy_qty ?? 1));
      const freeQty = Math.max(1, Math.round(d.bogo_free_qty ?? 1));
      const freeSet = d.free_product_ids ?? [];
      if (freeSet.length > 0) {
        // Cross-item BOGO ("buy X, get Y free"): qualify on applicable_*
        // (scope=everything → anything but the free item), free freeQty of
        // the chosen free product(s) per buyQty qualifying units bought.
        const hasApplicable =
          (d.applicable_products?.length ?? 0) > 0 || (d.applicable_categories?.length ?? 0) > 0;
        const isBuyLine = (l: CartLine): boolean => {
          if (freeSet.includes(l.product.id)) return false;
          if (!hasApplicable) return true;
          if (d.applicable_products?.includes(l.product.id)) return true;
          if (l.product.category && d.applicable_categories?.includes(l.product.category)) return true;
          return false;
        };
        const buyCount = lines.filter(isBuyLine).reduce((s, l) => s + l.qty, 0);
        const allowance = Math.floor(buyCount / buyQty) * freeQty;
        const freeUnits: number[] = [];
        for (const l of lines) {
          if (freeSet.includes(l.product.id)) for (let i = 0; i < l.qty; i++) freeUnits.push(l.unit_sen);
        }
        freeUnits.sort((a, b) => a - b);
        for (let i = 0; i < Math.min(allowance, freeUnits.length); i++) discount += freeUnits[i];
      } else {
        // Same-item BOGO: complete (buy+free) groups over the eligible pool.
        const units: number[] = [];
        for (const l of eligible) for (let i = 0; i < l.qty; i++) units.push(l.unit_sen);
        units.sort((a, b) => a - b);
        const totalFree = Math.floor(units.length / (buyQty + freeQty)) * freeQty;
        for (let i = 0; i < totalFree && i < units.length; i++) discount += units[i];
      }
      break;
    }
    case "combo": {
      // Every applicable_products entry must be present in the cart; the
      // bundle (one cheapest unit of each) is repriced to combo_price_sen.
      const required = d.applicable_products ?? [];
      if (required.length === 0 || d.combo_price_sen == null) return 0;
      const present = new Set(lines.map((l) => l.product.id));
      if (!required.every((pid) => present.has(pid))) return 0;
      let bundle = 0;
      for (const pid of required) {
        const cheapest = Math.min(
          ...lines.filter((l) => l.product.id === pid).map((l) => l.unit_sen),
        );
        if (Number.isFinite(cheapest)) bundle += cheapest;
      }
      discount = Math.max(0, bundle - d.combo_price_sen);
      break;
    }
    case "override_price": {
      // Cheapest eligible item repriced to override_price_sen.
      if (d.override_price_sen == null) return 0;
      const cheapest = Math.min(...eligible.map((l) => l.unit_sen));
      discount = Number.isFinite(cheapest) ? Math.max(0, cheapest - d.override_price_sen) : 0;
      break;
    }
    default:
      return 0; // beans_multiplier / none → no cart discount
  }
  return Math.max(0, Math.min(discount, cartSubtotal));
}

/**
 * Tier-perk discount (sen) — the member's tier % applied automatically,
 * mirroring the web register's stacking rule:
 *   • Non-stackable tiers (Staff / Black Card): % × RAW subtotal, and the
 *     voucher is dropped entirely (handled by the caller).
 *   • Stackable tiers (Bronze→Platinum): % × the post-voucher remainder,
 *     so the tier % stacks on top of the voucher.
 */
export function computeTierDiscount(tier: Tier, subtotalSen: number, rewardDiscountSen = 0): number {
  const pct = tier?.discount_percent ?? 0;
  if (pct <= 0) return 0;
  if (tier?.stackable === false) return Math.round((subtotalSen * pct) / 100);
  const remaining = Math.max(0, subtotalSen - rewardDiscountSen);
  return Math.round((remaining * pct) / 100);
}

export type AppliedPromo = { discountAmount: number; description: string };

/**
 * Server-side auto-promotions (time-window / category / promo-code combos)
 * via /api/pos/loyalty/evaluate-promotions — the same engine the web register
 * uses. Tier % is computed client-side (computeTierDiscount) and NOT sent
 * here, so the two never double-count. Best-effort: returns [] on error.
 */
export async function evaluatePromotions(args: {
  lines: { product_id: string; category?: string; quantity: number; unit_price: number }[];
  memberId?: string | null;
  outletId?: string | null;
  rewardDiscountSen?: number;
}): Promise<AppliedPromo[]> {
  if (args.lines.length === 0) return [];
  try {
    const res = await apiPost<{ discounts?: { discount_amount: number; promotion_name: string }[] }>(
      "/api/pos/loyalty/evaluate-promotions",
      {
        lines: args.lines,
        member_id: args.memberId ?? null,
        outlet_id: args.outletId ?? null,
        member_tier_id: null, // tier handled client-side to avoid double-count
        promo_code: null,
        reward_promotion_ids: [],
        reward_discount_rm: (args.rewardDiscountSen ?? 0) / 100,
      },
    );
    return (res.discounts ?? []).map((d) => ({
      discountAmount: Math.round((d.discount_amount ?? 0) * 100),
      description: d.promotion_name ?? "Promotion",
    }));
  } catch {
    return [];
  }
}

// ─── Customer-display snapshot (the rich 2nd-screen payload) ──
// Mirrors apps/pos/src/lib/loyalty-snapshot.ts → /api/pos/loyalty/snapshot.

export type SnapshotTierInfo = {
  name: string;
  color: string | null;
  multiplier: number;
  discount_percent: number;
  benefits: string[];
} | null;

export type SnapshotTier = {
  current: SnapshotTierInfo;
  next: SnapshotTierInfo;
  progress: { metric: "spend" | "visits"; current: number; target: number } | null;
};

export type VoucherCard = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  source_type: string | null;
  discount_type: string | null;
  discount_value: number | null;
  free_product_name: string | null;
};

export type ClaimableCard = {
  id: string;
  title: string;
  description: string | null;
  source_type: "promo" | "mystery_pending";
  cta_label: string;
};

export type ShopCard = {
  id: string;
  name: string;
  description: string | null;
  points_required: number;
  affordable: boolean;
};

export type MissionCard = {
  id: string;
  title: string;
  description: string;
  progress_current: number;
  progress_target: number;
  unit: "count" | "sen";
  reward_bonus_beans: number;
  status: "active" | "completed";
};

export type ActivePromo = {
  id: string;
  name: string;
  discount_label: string;
  window_label: string;
  flavour: "time_window" | "category" | "tag" | "always";
  live: boolean;
};

export type BiteItem = {
  id: string;
  name: string;
  category: string;
  price_sen: number;
  image_url: string | null;
};

export type LoyaltySnapshot = {
  member: { id: string; name: string | null; phone: string; total_visits: number; total_spent: number };
  balance: number;
  tier: SnapshotTier;
  vouchers: VoucherCard[];
  claimables: ClaimableCard[];
  missions: MissionCard[];
  usual: UsualItem[];
  popular_bites: BiteItem[];
  shop: ShopCard[];
  active_promos: ActivePromo[];
};

export async function fetchSnapshot(memberId: string): Promise<LoyaltySnapshot | null> {
  try {
    return await apiGet<LoyaltySnapshot>(`/api/pos/loyalty/snapshot?member_id=${encodeURIComponent(memberId)}`);
  } catch {
    return null;
  }
}

/** A suggested pairing for the current cart — from the shared scoring
 *  endpoint that both POS screens use, so the customer display and the
 *  register show the same 3 suggestions. */
export type SuggestedPair = {
  product_id: string;
  name: string;
  price_sen: number;
  image_url: string | null;
  reason: string;            // "Combo deal" | "Your usual" | "Often paired together" | …
  discount_label: string | null;
  combo_id: string | null;
};

/** Ask the pairing "agent" for the best 3 items to suggest alongside the
 *  current cart. Pass the member's usual ids (already in the snapshot) so the
 *  server can weight personalisation without re-querying. Best-effort → []. */
export async function fetchSuggestedPairs(
  outletId: string | null,
  cartProductIds: string[],
  usualProductIds: string[],
): Promise<SuggestedPair[]> {
  try {
    const res = await apiPost<{ pairs?: SuggestedPair[] }>("/api/pos/loyalty/suggest-pairs", {
      outlet_id: outletId,
      cart_product_ids: cartProductIds,
      usual_product_ids: usualProductIds,
    });
    return res?.pairs ?? [];
  } catch {
    return [];
  }
}

/** Lightweight read of currently-active combo + category promos for the
 *  customer-display ordering screen. Snapshot-style `active_promos` is
 *  member-gated; this is the guest fallback so the "Pair with a bite"
 *  banner still surfaces deals when no one has signed in yet.
 *
 *  Direct table read via anon key (RLS grants SELECT). Maps the raw
 *  promotions row into the same ActivePromo shape the display already
 *  knows how to render. */
export async function fetchActivePromos(): Promise<ActivePromo[]> {
  try {
    const { supabase } = await import("./supabase");
    const { data, error } = await supabase
      .from("promotions")
      .select("id, name, trigger_type, discount_type, discount_value, combo_category_ids, applicable_categories")
      .eq("is_active", true)
      .order("priority", { ascending: false })
      .limit(20);
    if (error) return [];
    return (data ?? []).map((p: any) => {
      const dv = Number(p.discount_value ?? 0);
      const isPct = p.discount_type === "percentage_off";
      const isFlat = p.discount_type === "fixed_amount_off";
      const label = isPct ? `${dv}% off` : isFlat ? `RM ${dv.toFixed(0)} off` : "Deal";
      const flavour: ActivePromo["flavour"] =
        Array.isArray(p.combo_category_ids) && p.combo_category_ids.length > 0
          ? "category"
          : Array.isArray(p.applicable_categories) && p.applicable_categories.length > 0
          ? "category"
          : "always";
      return {
        id: p.id,
        name: p.name,
        discount_label: label,
        window_label: "",
        flavour,
        live: true,
      };
    });
  } catch {
    return [];
  }
}

/** Run the loyalty order-hooks for a completed POS sale (award Beans, re-eval
 *  tier, spawn the Mystery Bean). The counter-sale equivalent of what the
 *  pickup flow does on payment confirmation. Fire-and-forget + idempotent
 *  server-side, so a missed/duplicate call never double-awards or blocks the
 *  sale. */
export async function posOrderComplete(memberId: string, orderId: string): Promise<void> {
  try {
    await apiPost("/api/pos/loyalty/complete", { member_id: memberId, order_id: orderId });
  } catch {
    /* best-effort — never block checkout on loyalty */
  }
}

/** A revealed mystery outcome — the raw fields the reveal card needs to
 *  render the native-app layout per outcome type. */
export type MysteryReveal = {
  outcome_type: "voucher" | "flat_beans" | "beans_multiplier" | "no_bonus" | "surprise_in_store" | "promo";
  multiplier_value: number | null;
  flat_beans_value: number | null;
  label: string;             // mystery_pool label (e.g. "Just your Beans")
  voucher_title: string | null; // the won voucher's title, if any
  emoji: string;             // pool reveal_emoji, or 🎁 fallback
};

/** Reveal a pending mystery drop. Returns the raw outcome so the reveal
 *  card can render the same per-outcome layout as the native app (the old
 *  code read fields that don't exist, so every reveal fell back to a
 *  generic "Reward unlocked"). */
export async function claimMystery(memberId: string, claimableId: string): Promise<MysteryReveal | null> {
  try {
    const res = await apiPost<any>("/api/pos/loyalty/claim", { member_id: memberId, claimable_id: claimableId });
    const m = res?.mystery ?? {};
    return {
      outcome_type: m.outcome_type ?? "no_bonus",
      multiplier_value: m.multiplier_value ?? null,
      flat_beans_value: m.flat_beans_value ?? null,
      label: m.label ?? "Mystery reward",
      voucher_title: res?.voucher?.title ?? null,
      emoji: m.reveal_emoji ?? "🎁",
    };
  } catch {
    return null;
  }
}
