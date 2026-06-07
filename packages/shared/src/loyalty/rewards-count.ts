// Canonical "Rewards" tally for the customer home tile + bottom-nav badge.
//
// Single source of truth so the number can't drift between surfaces — it did:
// the web PWA counted bean-shop (points_redemption) vouchers while pickup-
// native excluded them, and NEITHER counted claimables, so the home read
// LOWER than the /rewards screen it taps into (which lists owned + claimable).
//
// Consumed directly by the web PWA (apps/order). pickup-native can't depend on
// this server-leaning package, so it keeps a hand-synced mirror in
// apps/pickup-native/lib/rewards-v2.ts (tagged "Mirrors @celsius/shared
// countRewardsWaiting") — keep the two in lockstep.
//
// Rule (decided): a "Reward you have" = an ACTIVE wallet voucher from a WALLET
// source — mystery-bag win, manual admin grant, or birthday grant — PLUS every
// claimable offer (unrevealed mystery drop / admin push) waiting for one-tap
// claim. Bean-shop (points_redemption) + referral vouchers are NOT wallet items
// (points are a balance you spend, not a stored voucher).
//
// The home "Rewards" KPI ALSO surfaces affordable redeemable catalogue items
// (points-shop rewards the member can claim with their current balance) — via a
// separate countAffordableRewards() term the caller adds on top of this
// wallet+claimables tally. The UNaffordable catalogue is still never counted.
const WALLET_COUNT_SOURCES = ["mystery", "manual", "birthday"];

/** Minimal wallet-voucher shape the count needs. */
export type CountableVoucher = { status?: string | null; source_type?: string | null };

/**
 * @param vouchers   raw /api/loyalty/me/vouchers list (the wallet)
 * @param claimables raw /api/loyalty/me/claimable list (mystery + admin promos)
 * @returns active wallet vouchers + claimables
 */
export function countRewardsWaiting(
  vouchers: ReadonlyArray<CountableVoucher> | null | undefined,
  claimables: ReadonlyArray<unknown> | null | undefined,
): number {
  const owned = (vouchers ?? []).filter(
    (v) =>
      (v.status === "active" || !v.status) &&
      WALLET_COUNT_SOURCES.includes(v.source_type ?? ""),
  ).length;
  return owned + (claimables?.length ?? 0);
}

// A redeemable catalogue reward "you can claim now" = an ACTIVE points-shop
// reward the member can afford AND that's currently grantable: inside its valid
// window, in stock, under the per-member redemption cap, and pickup-capable.
// Mirrors the eligibility the pickup-native home applies client-side and the
// server-side fetchAffordableCatalogForMember the web /api/loyalty/rewards route
// already filters by. Callers add this on top of countRewardsWaiting so the home
// "Rewards" KPI = wallet vouchers + claimables + affordable catalogue.
export type AffordableReward = {
  is_active?: boolean | null;
  points_required?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  stock?: number | null;
  max_redemptions_per_member?: number | null;
  redemption_count?: number | null;
  fulfillment_type?: string[] | null;
};

export function countAffordableRewards(
  rewards: ReadonlyArray<AffordableReward> | null | undefined,
  points: number,
): number {
  const now = Date.now();
  return (rewards ?? []).filter((r) => {
    if (!r.is_active) return false;
    if ((r.points_required ?? 0) > points) return false;
    if (r.valid_from && new Date(r.valid_from).getTime() > now) return false;
    if (r.valid_until && new Date(r.valid_until).getTime() < now) return false;
    if (r.stock != null && r.stock <= 0) return false;
    if (
      r.max_redemptions_per_member != null &&
      (r.redemption_count ?? 0) >= r.max_redemptions_per_member
    ) {
      return false;
    }
    const ft = r.fulfillment_type;
    if (Array.isArray(ft) && ft.length > 0 && !ft.includes("pickup")) return false;
    return true;
  }).length;
}
