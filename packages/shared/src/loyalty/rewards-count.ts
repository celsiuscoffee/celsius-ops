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
// (points are a balance you spend, not a stored voucher), and the affordable
// points-shop catalogue is NOT counted either.
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
