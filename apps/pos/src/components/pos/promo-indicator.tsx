"use client";

import { formatRM } from "@celsius/shared";

import { useState } from "react";
import type { AppliedPromotion, Promotion, CartItem } from "@/types/database";
import { displayRM } from "@/types/database";
import { applyManualPromotion } from "@/lib/promotion-engine";

type Props = {
  autoPromotions: AppliedPromotion[];
  manualPromotions: Promotion[]; // available manual promos (percentage_off, amount_off)
  cart: CartItem[];
  appliedManualPromo: AppliedPromotion | null;
  onApplyManual: (promo: AppliedPromotion) => void;
  onRemoveManual: () => void;
};

export function PromoIndicator({
  autoPromotions,
  manualPromotions,
  cart,
  appliedManualPromo,
  onApplyManual,
  onRemoveManual,
}: Props) {
  const [showPromoList, setShowPromoList] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState("");

  const totalAutoDiscount = autoPromotions.reduce((sum, p) => sum + p.discountAmount, 0);

  function handleApplyCode() {
    if (!promoCode.trim()) return;
    const promo = manualPromotions.find(
      (p) => p.promo_code?.toLowerCase() === promoCode.trim().toLowerCase()
    );
    if (!promo) {
      setPromoError("Invalid promo code");
      return;
    }
    const result = applyManualPromotion(cart, promo);
    if (!result) {
      setPromoError("Conditions not met for this promotion");
      return;
    }
    onApplyManual(result);
    setShowPromoList(false);
    setPromoCode("");
    setPromoError("");
  }

  function handleSelectPromo(promo: Promotion) {
    const result = applyManualPromotion(cart, promo);
    if (!result) {
      setPromoError(`Conditions not met for "${promo.name}"`);
      return;
    }
    onApplyManual(result);
    setShowPromoList(false);
    setPromoError("");
  }

  return (
    <div>
      {/* Auto-applied promotions */}
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

      {/* Manual promotion applied */}
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

      {/* Apply promo button */}
      {!appliedManualPromo && cart.length > 0 && (
        <button
          onClick={() => setShowPromoList(!showPromoList)}
          className="mb-2 flex w-full items-center justify-between rounded-lg border border-dashed border-border px-3 py-1.5 text-[10px] transition-colors hover:border-brand hover:bg-brand/5"
        >
          <span className="text-text-muted">Apply promotion or promo code</span>
          <span className="text-brand">+</span>
        </button>
      )}

      {/* Promo selection panel */}
      {showPromoList && (
        <div className="mb-2 rounded-lg border border-border bg-surface-raised p-3">
          {/* Promo code input */}
          <div className="mb-2 flex gap-2">
            <input
              type="text" placeholder="Enter promo code" value={promoCode}
              onChange={(e) => { setPromoCode(e.target.value); setPromoError(""); }}
              className="h-7 flex-1 rounded border border-border bg-surface px-2 text-[10px] text-text outline-none placeholder:text-text-dim focus:border-brand"
              onKeyDown={(e) => e.key === "Enter" && handleApplyCode()}
            />
            <button onClick={handleApplyCode} className="rounded bg-brand px-3 py-1 text-[10px] font-semibold text-white hover:bg-brand-dark">
              Apply
            </button>
          </div>
          {promoError && <p className="mb-2 text-[10px] text-danger">{promoError}</p>}

          {/* Available manual promotions */}
          {manualPromotions.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] text-text-dim">Available promotions</p>
              <div className="space-y-1">
                {manualPromotions.map((promo) => (
                  <button
                    key={promo.id}
                    onClick={() => handleSelectPromo(promo)}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-left transition-colors hover:border-brand hover:bg-brand/5"
                  >
                    <div>
                      <p className="text-[10px] font-medium">{promo.name}</p>
                      {promo.promo_code && <p className="text-[9px] text-text-dim">Code: {promo.promo_code}</p>}
                    </div>
                    <span className="text-[10px] text-brand">
                      {promo.discount_type === "percentage_off" ? `${(promo.discount_value ?? 0) / 100}% Off` : `${formatRM(((promo.discount_value ?? 0) / 100))} Off`}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
