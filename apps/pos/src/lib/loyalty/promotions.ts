/**
 * POS register client for the auto-promotion + tier-discount engine.
 *
 * Mirrors apps/order/src/lib/loyalty/promotions.ts so a member sees the
 * same discount whether they order in-store (POS) or via pickup (order
 * app). The actual engine lives in apps/loyalty — this module just
 * adapts cart shapes and folds the result into the register's existing
 * AppliedPromotion[] pipeline.
 *
 * Boundary contract:
 *   • POS works in sen everywhere. Engine + tier post-step work in RM
 *     (number with 2dp). We convert at this boundary only.
 *   • A line's unit_price for the engine is (item.unitPrice + modifierTotal),
 *     NOT product list price — promos like "10% off cart" must see the
 *     real money the customer is paying, including modifier upcharges.
 */

import type { CartItem, AppliedPromotion, Promotion } from "@/types/database";

interface EngineLine {
  product_id: string;
  category?: string;
  tags?: string[];
  quantity: number;
  unit_price: number; // RM
}

interface EngineDiscount {
  promotion_id: string;
  promotion_name: string;
  discount_type: string;
  discount_amount: number; // RM saved
  affected_lines: number[];
  reason: string;
}

interface EvaluatedCart {
  subtotal: number;
  discounts: EngineDiscount[];
  total_discount: number;
  total: number;
}

/**
 * Build the engine payload from the POS cart. Modifier upcharges are
 * baked into unit_price so promos see the real per-line money. Tags +
 * category are sent through so tag-keyed promos (e.g. "boss price",
 * staff discount) match correctly.
 */
export function buildEngineLines(cart: CartItem[]): EngineLine[] {
  return cart.map((item) => ({
    product_id: item.product.id,
    category:   item.product.category ?? undefined,
    tags:       item.product.tags ?? undefined,
    quantity:   item.quantity,
    // Sen → RM. Include modifier upcharges in unit_price so a
    // percentage promo discounts the full per-item price the customer
    // actually pays.
    unit_price: (item.unitPrice + item.modifierTotal) / 100,
  }));
}

/**
 * Convert the engine's RM-denominated discount list into the
 * register's sen-denominated AppliedPromotion[]. Most callers only
 * read .discountAmount and .description so we stub the rest of the
 * Promotion shape with the engine's id + name.
 */
function toAppliedPromotions(
  discounts: EngineDiscount[],
  cart: CartItem[],
): AppliedPromotion[] {
  return discounts.map((d) => {
    const affectedItemIds = (d.affected_lines ?? [])
      .map((idx) => cart[idx]?.cartItemId)
      .filter((id): id is string => !!id);
    // Stub Promotion — only .id is actually read by the UI (used as
    // a React key). The other fields exist on the legacy POS type
    // and are filled with safe defaults rather than left undefined.
    const promotion: Promotion = {
      id: d.promotion_id,
      brand_id: "brand-celsius",
      name: d.promotion_name,
      promo_code: null,
      discount_type: "percentage_off",
      discount_value: null,
      combo_price: null,
      override_price: null,
      buy_quantity: null,
      free_quantity: null,
      apply_to: "all_orders",
      apply_min_order: null,
      apply_categories: [],
      apply_tags: [],
      apply_product_ids: [],
      apply_min_qty: null,
      apply_max_qty: null,
      require_purchase: false,
      require_categories: [],
      require_tags: [],
      require_product_ids: [],
      require_min_qty: null,
      customer_eligibility: "everyone",
      eligible_customer_tags: [],
      eligible_membership_tiers: [],
      total_usage_limit: null,
      per_customer_limit: null,
      current_usage_count: 0,
      allow_repeat: true,
      channels: [],
      branch_ids: null,
      is_enabled: true,
      start_date: null,
      end_date: null,
      created_at: "",
      updated_at: "",
    };
    return {
      promotion,
      // RM → sen, round to integer cents to avoid float drift.
      discountAmount: Math.round(d.discount_amount * 100),
      affectedItemIds,
      description:    d.promotion_name,
    };
  });
}

interface EvaluateArgs {
  cart: CartItem[];
  memberId?: string | null;
  memberTierId?: string | null;
  outletId?: string | null;
  rewardPromotionIds?: string[];
  /** Customer-provided code (typed by cashier into the promo input).
   *  Engine matches against `promotions.promo_code` and adds the
   *  resulting discount to the returned list. */
  promoCode?: string | null;
  /** POS-side voucher discount in sen. Used by the tier post-step:
   *  stackable tiers subtract this from the remainder before applying
   *  %, so the tier discount doesn't double-count the voucher's
   *  RM value. */
  rewardDiscountSen?: number;
  signal?: AbortSignal;
}

/**
 * Evaluate the current cart against active auto-promotions and apply
 * the member's tier % discount on top. Failure / abort → empty list
 * (cart still rings up at full price).
 */
export async function evaluatePromotions(args: EvaluateArgs): Promise<AppliedPromotion[]> {
  if (args.cart.length === 0) return [];
  const lines = buildEngineLines(args.cart);
  try {
    const res = await fetch("/api/loyalty/evaluate-promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines,
        member_id:           args.memberId ?? null,
        outlet_id:           args.outletId ?? null,
        member_tier_id:      args.memberTierId ?? null,
        promo_code:          args.promoCode ?? null,
        reward_promotion_ids: args.rewardPromotionIds ?? [],
        reward_discount_rm:  (args.rewardDiscountSen ?? 0) / 100,
      }),
      signal: args.signal,
    });
    if (!res.ok) return [];
    const evaluated = (await res.json()) as EvaluatedCart;
    return toAppliedPromotions(evaluated.discounts ?? [], args.cart);
  } catch {
    return [];
  }
}
