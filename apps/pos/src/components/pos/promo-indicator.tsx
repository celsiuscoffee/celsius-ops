"use client";

import { Gift } from "lucide-react";
import type { AppliedPromotion, Promotion, CartItem } from "@/types/database";
import { displayRM } from "@/types/database";

type Props = {
  autoPromotions: AppliedPromotion[];
  /** Kept for backwards compat — currently unused, manual-promo flow
   *  is replaced by the central evaluate-promotions engine. */
  manualPromotions?: Promotion[];
  cart: CartItem[];
  appliedManualPromo: AppliedPromotion | null;
  onApplyManual?: (promo: AppliedPromotion) => void;
  onRemoveManual: () => void;
  /** When a member is identified, opens the RewardPickerModal so the
   *  cashier can pick from issued vouchers + Spend Beans rewards (the
   *  list comes from /api/loyalty/rewards filtered by member tier +
   *  balance). When null, the Redeem button is hidden because we have
   *  no member context to fetch rewards for. */
  memberId: string | null;
  onOpenRewards: () => void;
};

export function PromoIndicator({
  autoPromotions,
  cart,
  appliedManualPromo,
  onRemoveManual,
  memberId,
  onOpenRewards,
}: Props) {
  return (
    <div>
      {/* Auto-applied promotions — engine-evaluated tier discounts,
          time-window promos, code matches, etc. Each gets a green
          AUTO pill so the cashier sees what saved the customer money. */}
      {autoPromotions.length > 0 && (
        <div className="space-y-1 mb-2">
          {autoPromotions.map((ap) => (
            <div key={ap.promotion.id} className="flex items-center justify-between rounded-lg bg-success/10 px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-success">AUTO</span>
                <span className="text-[10px] text-success">{ap.description}</span>
              </div>
              <span className="text-[10px] font-semibold text-success">-{displayRM(ap.discountAmount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Manual promotion applied (legacy — rare today) */}
      {appliedManualPromo && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-brand/10 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-brand">PROMO</span>
            <span className="text-[10px] text-brand">{appliedManualPromo.description}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-brand">-{displayRM(appliedManualPromo.discountAmount)}</span>
            <button onClick={onRemoveManual} className="text-[10px] text-brand hover:underline">Remove</button>
          </div>
        </div>
      )}

      {/* Redeem Reward — primary action for member-driven discounts.
          Opens RewardPickerModal which fetches the full list of
          issued vouchers + affordable Spend Beans rewards for THIS
          member. Replaces the previous "Apply promo code" button —
          promo codes aren't really rewards, and the rewards modal is
          where the member-specific discount story lives. */}
      {memberId && cart.length > 0 && (
        <button
          onClick={onOpenRewards}
          className="mb-2 flex w-full items-center justify-between rounded-lg border border-dashed border-brand/40 bg-brand/5 px-3 py-2 text-[11px] transition-colors hover:border-brand hover:bg-brand/10"
        >
          <span className="flex items-center gap-1.5 font-semibold text-brand">
            <Gift className="h-3.5 w-3.5" />
            Redeem Reward
          </span>
          <span className="text-brand">›</span>
        </button>
      )}
    </div>
  );
}
