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
// Rule (decided): a "Reward you have" = any ACTIVE wallet voucher, REGARDLESS
// of how it was obtained (earned, gifted, OR bought with points/beans), PLUS
// every claimable offer (unrevealed mystery drop / admin push) waiting for
// one-tap claim. The affordable points-shop catalogue is NOT counted (things
// you could buy, not things you have).

/** Minimal wallet-voucher shape the count needs. */
export type CountableVoucher = { status?: string | null };

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
    (v) => v.status === "active" || !v.status,
  ).length;
  return owned + (claimables?.length ?? 0);
}
