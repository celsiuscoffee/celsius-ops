import type { CartItem, Promotion, AppliedPromotion } from "@/types/database";
import { formatRM } from "@celsius/shared";
import { memberMeetsEligibility, type LoyaltyMember } from "./customer-lookup";

/**
 * StoreHub-compatible promotion engine with customer eligibility.
 *
 * Customer eligibility (checked before applying any promo):
 *   - everyone: no restriction
 *   - customer_tags: member must have at least one matching tag (VIP, Staff, Loyal, etc.)
 *   - membership: member must be on a specific tier (SH_Tier_1, SH_Tier_2, etc.)
 *   - first_time: member has 0-1 visits
 *
 * Auto-apply types (checked every cart change):
 *   - buy_x_get_y: lowest-priced qualifying item(s) free
 *   - combo_bundle: fixed price for a set of items
 *   - override_price: replace price on qualifying items
 *
 * Manual-apply types (staff taps "Apply Promotion" on POS):
 *   - percentage_off: % off qualifying items/order
 *   - amount_off: fixed RM off qualifying items/order
 */

export function evaluatePromotions(
  cart: CartItem[],
  promotions: Promotion[],
  branchId: string,
  member?: LoyaltyMember | null,
): AppliedPromotion[] {
  const now = new Date();
  const results: AppliedPromotion[] = [];

  // Only active, enabled promos for this branch, POS channel, and eligible customer
  const activePromos = promotions.filter((p) => {
    if (!p.is_enabled) return false;
    if (!p.channels.includes("pos")) return false;
    if (p.branch_ids && p.branch_ids.length > 0 && !p.branch_ids.includes(branchId)) return false;
    if (p.start_date && new Date(p.start_date) > now) return false;
    if (p.end_date && new Date(p.end_date) < now) return false;

    // Customer eligibility check (StoreHub-style)
    if (p.customer_eligibility !== "everyone") {
      if (!memberMeetsEligibility(
        member ?? null,
        p.customer_eligibility,
        p.eligible_customer_tags ?? [],
        p.eligible_membership_tiers ?? [],
      )) return false;
    }
    return true;
  });

  // Auto-apply promotions
  for (const promo of activePromos) {
    if (promo.discount_type === "buy_x_get_y") {
      const result = evaluateBuyXGetY(cart, promo);
      if (result) results.push(result);
    } else if (promo.discount_type === "combo_bundle") {
      const result = evaluateComboBundle(cart, promo);
      if (result) results.push(result);
    } else if (promo.discount_type === "override_price") {
      const result = evaluateOverridePrice(cart, promo);
      if (result) results.push(result);
    }
  }

  return results;
}

/**
 * Apply a manual promotion (percentage_off or amount_off)
 */
export function applyManualPromotion(
  cart: CartItem[],
  promo: Promotion,
  member?: LoyaltyMember | null,
): AppliedPromotion | null {
  // Check customer eligibility
  if (promo.customer_eligibility !== "everyone") {
    if (!memberMeetsEligibility(
      member ?? null,
      promo.customer_eligibility,
      promo.eligible_customer_tags ?? [],
      promo.eligible_membership_tiers ?? [],
    )) return null;
  }
  if (promo.discount_type === "percentage_off") {
    return evaluatePercentageOff(cart, promo);
  } else if (promo.discount_type === "amount_off") {
    return evaluateAmountOff(cart, promo);
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────

function getQualifyingItems(cart: CartItem[], promo: Promotion): CartItem[] {
  return cart.filter((item) => itemMatchesTarget(item, promo));
}

function itemMatchesTarget(item: CartItem, promo: Promotion): boolean {
  switch (promo.apply_to) {
    case "all_orders":
      return true;
    case "category":
      return promo.apply_categories.includes(item.product.category ?? "");
    case "tags":
      return promo.apply_tags.some((tag) => item.product.tags.includes(tag));
    case "specific_products":
      return promo.apply_product_ids.includes(item.product.id);
    case "orders_over":
      return true; // checked at order level
    default:
      return false;
  }
}

function meetsRequiredPurchase(cart: CartItem[], promo: Promotion): boolean {
  if (!promo.require_purchase) return true;

  const requiredItems = cart.filter((item) => {
    if (promo.require_product_ids.length > 0) return promo.require_product_ids.includes(item.product.id);
    if (promo.require_categories.length > 0) return promo.require_categories.includes(item.product.category ?? "");
    if (promo.require_tags.length > 0) return promo.require_tags.some((tag) => item.product.tags.includes(tag));
    return false;
  });

  const totalQty = requiredItems.reduce((sum, i) => sum + i.quantity, 0);
  return totalQty >= (promo.require_min_qty ?? 1);
}

// ─── Type-specific evaluators ────────────────────────────────

function evaluatePercentageOff(cart: CartItem[], promo: Promotion): AppliedPromotion | null {
  if (!meetsRequiredPurchase(cart, promo)) return null;

  const qualifying = getQualifyingItems(cart, promo);
  if (qualifying.length === 0) return null;

  // Check min order
  if (promo.apply_to === "orders_over" && promo.apply_min_order) {
    const orderTotal = cart.reduce((sum, i) => sum + i.lineTotal, 0);
    if (orderTotal < promo.apply_min_order) return null;
  }

  const qualifyingTotal = qualifying.reduce((sum, i) => sum + i.lineTotal, 0);
  const pctBasisPoints = promo.discount_value ?? 0;
  const discountAmount = Math.round(qualifyingTotal * pctBasisPoints / 10000);

  return {
    promotion: promo,
    discountAmount,
    affectedItemIds: qualifying.map((i) => i.cartItemId),
    description: `${pctBasisPoints / 100}% Off${promo.name ? ` (${promo.name})` : ""}`,
  };
}

function evaluateAmountOff(cart: CartItem[], promo: Promotion): AppliedPromotion | null {
  if (!meetsRequiredPurchase(cart, promo)) return null;

  const qualifying = getQualifyingItems(cart, promo);
  if (qualifying.length === 0) return null;

  if (promo.apply_to === "orders_over" && promo.apply_min_order) {
    const orderTotal = cart.reduce((sum, i) => sum + i.lineTotal, 0);
    if (orderTotal < promo.apply_min_order) return null;
  }

  const discountAmount = promo.discount_value ?? 0;

  return {
    promotion: promo,
    discountAmount,
    affectedItemIds: qualifying.map((i) => i.cartItemId),
    description: `${formatRM((discountAmount / 100))} Off${promo.name ? ` (${promo.name})` : ""}`,
  };
}

function evaluateBuyXGetY(cart: CartItem[], promo: Promotion): AppliedPromotion | null {
  const qualifying = getQualifyingItems(cart, promo);
  const totalQty = qualifying.reduce((sum, i) => sum + i.quantity, 0);

  const buyQty = promo.buy_quantity ?? 1;
  const freeQty = promo.free_quantity ?? 1;
  const setSize = buyQty + freeQty;

  if (totalQty < setSize) return null;

  // How many complete sets?
  const sets = promo.allow_repeat ? Math.floor(totalQty / setSize) : 1;
  const freeItems = sets * freeQty;

  // Sort by price ascending — cheapest items are free (StoreHub behavior)
  const expandedItems: { cartItemId: string; unitPrice: number }[] = [];
  for (const item of qualifying) {
    for (let i = 0; i < item.quantity; i++) {
      expandedItems.push({ cartItemId: item.cartItemId, unitPrice: item.unitPrice + item.modifierTotal });
    }
  }
  expandedItems.sort((a, b) => a.unitPrice - b.unitPrice);

  const freeSlice = expandedItems.slice(0, freeItems);
  const discountAmount = freeSlice.reduce((sum, i) => sum + i.unitPrice, 0);
  const affectedIds = [...new Set(freeSlice.map((i) => i.cartItemId))];

  return {
    promotion: promo,
    discountAmount,
    affectedItemIds: affectedIds,
    description: `Buy ${buyQty} Get ${freeQty} Free (${promo.name})`,
  };
}

function evaluateComboBundle(cart: CartItem[], promo: Promotion): AppliedPromotion | null {
  const qualifying = getQualifyingItems(cart, promo);
  if (qualifying.length === 0) return null;

  // Check min qty per product
  if (promo.apply_min_qty) {
    const totalQty = qualifying.reduce((sum, i) => sum + i.quantity, 0);
    if (totalQty < promo.apply_min_qty) return null;
  }

  // Combo price replaces the total of qualifying items
  const qualifyingTotal = qualifying.reduce((sum, i) => sum + i.lineTotal, 0);
  const comboPrice = promo.combo_price ?? 0;
  const discountAmount = Math.max(0, qualifyingTotal - comboPrice);

  if (discountAmount <= 0) return null;

  return {
    promotion: promo,
    discountAmount,
    affectedItemIds: qualifying.map((i) => i.cartItemId),
    description: `Combo: ${promo.name} (${formatRM((comboPrice / 100))})`,
  };
}

function evaluateOverridePrice(cart: CartItem[], promo: Promotion): AppliedPromotion | null {
  if (!meetsRequiredPurchase(cart, promo)) return null;

  const qualifying = getQualifyingItems(cart, promo);
  if (qualifying.length === 0) return null;

  const newPrice = promo.override_price ?? 0;
  const maxQty = promo.apply_max_qty ?? Infinity;
  let discountTotal = 0;
  let discountedUnits = 0;
  const affectedIds: string[] = [];

  for (const item of qualifying) {
    const originalUnitPrice = item.unitPrice + item.modifierTotal;
    const unitsToDiscount = Math.min(item.quantity, maxQty - discountedUnits);
    if (unitsToDiscount <= 0) break;

    const savings = (originalUnitPrice - newPrice) * unitsToDiscount;
    if (savings > 0) {
      discountTotal += savings;
      discountedUnits += unitsToDiscount;
      affectedIds.push(item.cartItemId);
    }
  }

  if (discountTotal <= 0) return null;

  return {
    promotion: promo,
    discountAmount: discountTotal,
    affectedItemIds: affectedIds,
    description: `${promo.name} (${formatRM((newPrice / 100))} each)`,
  };
}
