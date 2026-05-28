/**
 * Applied-reward shape persisted in the SPA's Zustand store
 * (localStorage key "celsius-pickup", state.appliedReward). Mirrors
 * apps/pickup-native/lib/store.ts AppliedReward so a reward applied on
 * one surface reads correctly on the other.
 */
export type AppliedReward = {
  id: string;
  name: string;
  points_required?: number;
  discount_type:
    | "flat"
    | "percent"
    | "free_item"
    | "bogo"
    | "fixed_amount"
    | "percentage"
    | "none"
    | null;
  discount_value: number | null;
  bogo_buy_qty?: number;
  bogo_free_qty?: number;
  free_product_name?: string | null;
  applicable_categories?: string[] | null;
  applicable_products?: string[] | null;
  min_order_value?: number | null;
  voucher_id?: string;
};

type CartLine = {
  productId?: string;
  category?: string;
  basePrice: number;
  totalPrice: number;
  quantity: number;
};

/**
 * Client-side reward-discount preview. Port of
 * apps/pickup-native/lib/rewards.ts calcRewardDiscount. The server
 * recomputes the authoritative discount at checkout; this keeps the
 * cart/checkout totals honest so the customer sees the same number.
 */
export function calcRewardDiscount(
  reward: AppliedReward | null,
  cartItems: CartLine[],
  subtotal: number,
): number {
  if (!reward) return 0;
  if (reward.min_order_value != null && subtotal < reward.min_order_value) return 0;

  const cats = reward.applicable_categories;
  const prods = reward.applicable_products;
  const hasFilter = (cats && cats.length > 0) || (prods && prods.length > 0);
  const someHaveCategory = cartItems.some((i) => !!i.category);
  const eligible =
    hasFilter && someHaveCategory
      ? cartItems.filter((i) => {
          if (cats && cats.length > 0 && i.category && cats.includes(i.category)) return true;
          if (prods && prods.length > 0 && i.productId && prods.includes(i.productId)) return true;
          return false;
        })
      : cartItems;

  const t = reward.discount_type;
  if (t === "free_item") {
    if (eligible.length === 0) return 0;
    return Math.min(...eligible.map((i) => i.basePrice));
  }
  if (t === "bogo") {
    if (eligible.length === 0) return 0;
    const unitPrices = eligible.flatMap((i) =>
      Array(i.quantity).fill(i.totalPrice / i.quantity),
    ) as number[];
    unitPrices.sort((a, b) => b - a);
    // Free the cheaper of the top pair (preview only; engine is authoritative).
    return unitPrices.length >= 2 ? unitPrices[1] : 0;
  }
  if ((t === "percent" || t === "percentage") && reward.discount_value) {
    return subtotal * (reward.discount_value / 100);
  }
  if (t === "flat" && reward.discount_value) {
    return reward.discount_value / 100;
  }
  if (t === "fixed_amount" && reward.discount_value) {
    return reward.discount_value;
  }
  return 0;
}

export function formatRewardValue(r: AppliedReward): string {
  if (r.discount_type === "flat" || r.discount_type === "fixed_amount") {
    const cents = r.discount_value ?? 0;
    const value = r.discount_type === "flat" ? cents / 100 : cents;
    return `RM${value.toFixed(2).replace(/\.00$/, "")} off`;
  }
  if (r.discount_type === "percent" || r.discount_type === "percentage") {
    return `${r.discount_value ?? 0}% off`;
  }
  if (r.discount_type === "free_item") {
    return r.free_product_name ? `Free ${r.free_product_name}` : "Free item";
  }
  if (r.discount_type === "bogo") {
    return `Buy ${r.bogo_buy_qty} get ${r.bogo_free_qty} free`;
  }
  return "Reward";
}
