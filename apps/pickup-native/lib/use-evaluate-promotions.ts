import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "./store";
import { evaluatePromotions, type EvaluatedCart, type PromoLine } from "./rewards";

/**
 * Shared cache for the discount engine's evaluation. Cart and
 * checkout both need this — without a shared cache they each fire
 * their own fetch (~800ms each via the order→loyalty proxy chain),
 * doubling the work and making the cart → checkout transition feel
 * laggy even though the eval result is identical.
 *
 * React Query dedupes by queryKey, so as long as the cart shape +
 * member context match, both screens hit the same in-memory entry.
 * Stale time = 30s, which is far longer than a typical cart→checkout
 * navigation but short enough that time-windowed promos (e.g. an
 * 8-10am combo expiring) refresh on the next interaction.
 *
 * Returns the same shape as the old useState pattern: data | null,
 * plus an explicit error flag so the caller can hide reward UI when
 * the engine is unreachable.
 */

export type UseEvaluatePromotionsResult = {
  data: EvaluatedCart | null;
  isLoading: boolean;
  isError: boolean;
};

export function useEvaluatePromotions(args: {
  memberTierId?: string | null;
  /** Hold the eval back until upstream data is ready (e.g. tier).
   *  When false, the hook returns null without firing the network call.
   *  Defaults to true. */
  enabled?: boolean;
}): UseEvaluatePromotionsResult {
  const cart = useApp((s) => s.cart);
  const loyaltyId = useApp((s) => s.loyaltyId);
  const outletId = useApp((s) => s.outletId);
  const memberTierId = args.memberTierId ?? null;
  const enabled = (args.enabled ?? true) && cart.length > 0;

  // Cart shape → stable key. JSON.stringify is fine for the typical
  // single-digit cart size; the result is short, and React Query
  // compares it as a plain string.
  const lineHash = cart
    .map((c) => `${c.productId}|${c.category ?? ""}|${c.quantity}|${(c.totalPrice / c.quantity).toFixed(2)}`)
    .join(";");

  const q = useQuery({
    queryKey: ["promo-eval", lineHash, loyaltyId ?? "", outletId ?? "", memberTierId ?? ""],
    queryFn: async () => {
      const lines: PromoLine[] = cart.map((c) => ({
        product_id: c.productId,
        category:   c.category,
        quantity:   c.quantity,
        unit_price: c.totalPrice / c.quantity,
      }));
      const res = await evaluatePromotions({
        lines,
        member_id:     loyaltyId,
        outlet_id:     outletId,
        member_tier_id: memberTierId,
      });
      if (res.kind === "error") throw new Error(res.reason);
      return res.data;
    },
    enabled,
    staleTime: 30_000,
    // Always keep the previous result while a refetch is in flight —
    // prevents the discount lines from flickering off and back on as
    // the customer tweaks the cart.
    placeholderData: (previous) => previous,
  });

  return {
    data:      q.data ?? null,
    isLoading: q.isPending && enabled,
    isError:   q.isError,
  };
}

/** Manually invalidate the eval cache. Use when something that
 *  affects discount math changes outside the queryKey — e.g. when
 *  the customer pulls to refresh the cart. */
export function useInvalidateEvaluatePromotions(): () => void {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["promo-eval"] });
}
