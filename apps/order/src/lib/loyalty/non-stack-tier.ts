// Non-stackable tier exclusivity — the web twin of the POS register rule.
//
// A non-stackable tier (Black Card 50% / Staff 30%) trades stacking for a higher
// flat rate, so it's EXCLUSIVE: the member gets the single larger of
//   (tier %)  vs  (everything else: wallet voucher + reward + first-order
//                  discount + store auto-promotions)
// — never the sum. A 50% Black Card must not also pile store promos on top of
// the half-price bill. Stackable tiers (Member / Silver / Gold / Platinum) pass
// through unchanged, so this only ever affects Black Card / Staff orders.
//
// The promo engine bundles the tier perk AND store promos together in
// evaluated.total_discount; callers split them via the tier_perk leg and pass
// the parts here in sen. Pure — returns reconciled legs; mutates nothing.

export function reconcileNonStackTier(args: {
  stackable: boolean;
  /** round(evaluated.total_discount * 100) — tier perk + store promos combined. */
  evaluatedTotalSen: number;
  /** The tier_perk leg within `evaluated`, round(* 100). */
  tierPerkSen: number;
  voucherSen: number;
  rewardSen: number;
  fodSen: number;
}): {
  /** The engine-portion discount to charge (replaces the raw evaluated total). */
  promoDiscountSen: number;
  voucherSen: number;
  rewardSen: number;
  fodSen: number;
  /** Tier won → wallet legs (voucher/reward/FOD) were dropped; caller must NOT
   *  consume them (null walletVoucherId / rewardId / voucherCode). */
  droppedWallet: boolean;
  /** Others won → the tier perk was dropped from the charged total. */
  droppedTierPerk: boolean;
} {
  const storePromoSen = Math.max(0, args.evaluatedTotalSen - args.tierPerkSen);

  // Stackable tier (or no tier perk) → everything layers, unchanged.
  if (args.stackable || args.tierPerkSen <= 0) {
    return {
      promoDiscountSen: args.evaluatedTotalSen,
      voucherSen: args.voucherSen,
      rewardSen: args.rewardSen,
      fodSen: args.fodSen,
      droppedWallet: false,
      droppedTierPerk: false,
    };
  }

  const othersSen = args.voucherSen + args.rewardSen + args.fodSen + storePromoSen;

  if (args.tierPerkSen >= othersSen) {
    // Tier wins → exclusive: keep only the tier perk, drop store promos + wallet.
    return {
      promoDiscountSen: args.tierPerkSen,
      voucherSen: 0,
      rewardSen: 0,
      fodSen: 0,
      droppedWallet: true,
      droppedTierPerk: false,
    };
  }

  // Everything else wins → drop the tier perk, keep voucher + reward + FOD +
  // store promos.
  return {
    promoDiscountSen: storePromoSen,
    voucherSen: args.voucherSen,
    rewardSen: args.rewardSen,
    fodSen: args.fodSen,
    droppedWallet: false,
    droppedTierPerk: true,
  };
}
