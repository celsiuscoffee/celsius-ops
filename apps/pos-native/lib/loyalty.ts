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
  type: string | null; // "flat" | "percent" | "free_item" | "free_upgrade" | "none"
  value: number | null;
  max_discount: number | null;
  min_order: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
};

export type RedeemResponse = {
  success: boolean;
  redemption_id: string;
  points_spent: number;
  new_balance: number;
  reward_name: string;
  discount: RedeemDiscount;
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
    `/api/loyalty/lookup?phone=${encodeURIComponent(phone)}&create=1`,
  );
  return res.member ?? null;
}

export async function fetchRewards(memberId: string): Promise<RewardsResponse> {
  const res = await apiGet<RewardsResponse>(
    `/api/loyalty/rewards?member_id=${encodeURIComponent(memberId)}`,
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
      `/api/loyalty/snapshot?member_id=${encodeURIComponent(memberId)}`,
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
}): Promise<RedeemResponse> {
  return apiPost<RedeemResponse>("/api/loyalty/redeem", {
    member_id: args.memberId,
    reward_id: args.rewardId,
    outlet_id: args.outletId,
    issued_reward_id: args.issuedRewardId ?? null,
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
    case "free_item":
    case "free_upgrade": {
      const cheapest = Math.min(...eligible.map((l) => l.unit_sen));
      discount = Number.isFinite(cheapest) ? cheapest : 0;
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
 * via /api/loyalty/evaluate-promotions — the same engine the web register
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
      "/api/loyalty/evaluate-promotions",
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
// Mirrors apps/pos/src/lib/loyalty-snapshot.ts → /api/loyalty/snapshot.

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
    return await apiGet<LoyaltySnapshot>(`/api/loyalty/snapshot?member_id=${encodeURIComponent(memberId)}`);
  } catch {
    return null;
  }
}

/** Reveal a pending mystery drop. Best-effort — returns a human label. */
export async function claimMystery(memberId: string, claimableId: string): Promise<{ label: string; emoji: string } | null> {
  try {
    const res = await apiPost<any>("/api/loyalty/claim", { member_id: memberId, claimable_id: claimableId });
    return {
      label: res?.reward_name ?? res?.title ?? (res?.beans ? `${res.beans} Beans` : "Reward unlocked"),
      emoji: res?.emoji ?? "🎁",
    };
  } catch {
    return null;
  }
}
