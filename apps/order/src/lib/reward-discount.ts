/**
 * Applied-reward shape persisted in the SPA's Zustand store
 * (localStorage key "celsius-pickup", state.appliedReward). Mirrors
 * apps/pickup-native/lib/store.ts AppliedReward so a reward applied on
 * one surface reads correctly on the other.
 */
import {
  computeVoucherDiscount,
  type VoucherDiscountSpec,
  type DiscountCartLine,
} from "@celsius/shared";

export type AppliedReward = {
  id: string;
  name: string;
  points_required?: number;
  discount_type:
    | "flat"
    | "percent"
    | "free_item"
    | "free_upgrade"
    | "bogo"
    | "combo"
    | "override_price"
    | "fixed_amount"
    | "percentage"
    | "none"
    | null;
  discount_value: number | null;
  max_discount_value?: number | null;
  bogo_buy_qty?: number;
  bogo_free_qty?: number;
  /** combo bundle price / override single-item price, in SEN. */
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
  /** bogo/free_item: the specific product(s) given free. */
  free_product_ids?: string[] | null;
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

/** Map the stored reward → the shared engine's sen-based spec. Normalises
 *  the legacy POS vocab (fixed_amount/percentage) to canonical, converting
 *  the legacy fixed_amount value (RM) to sen. min_order_value /
 *  max_discount_value are already SEN and pass straight through. */
function toSpec(reward: AppliedReward): VoucherDiscountSpec {
  let dt: string | null = reward.discount_type;
  let dv = reward.discount_value;
  if (dt === "fixed_amount") {
    dt = "flat";
    dv = dv != null ? Math.round(dv * 100) : null; // legacy RM → sen
  } else if (dt === "percentage") {
    dt = "percent";
  }
  return {
    discount_type: (dt as VoucherDiscountSpec["discount_type"]) ?? null,
    discount_value: dv,
    max_discount_value_sen: reward.max_discount_value ?? null,
    min_order_value_sen: reward.min_order_value ?? null, // already SEN
    applicable_categories: reward.applicable_categories ?? null,
    applicable_products: reward.applicable_products ?? null,
    free_product_ids: reward.free_product_ids ?? null,
    free_product_name: reward.free_product_name ?? null,
    bogo_buy_qty: reward.bogo_buy_qty ?? null,
    bogo_free_qty: reward.bogo_free_qty ?? null,
    combo_price_sen: reward.combo_price_sen ?? null,
    override_price_sen: reward.override_price_sen ?? null,
  };
}

/**
 * Client-side reward-discount preview, returned in RM. Delegates to the
 * shared @celsius/shared computeVoucherDiscount — the EXACT engine the
 * server uses at checkout (/api/orders + /api/checkout/initiate) — so the
 * cart/checkout total the customer sees matches what they're charged,
 * across all 9 discount types. The server remains authoritative; this is
 * the preview.
 */
export function calcRewardDiscount(
  reward: AppliedReward | null,
  cartItems: CartLine[],
  _subtotal: number,
): number {
  if (!reward) return 0;
  const cart: DiscountCartLine[] = cartItems.map((i) => {
    const qty = Math.max(1, i.quantity);
    const effRm = i.totalPrice / qty; // per-unit, incl modifiers
    const modRm = Math.max(0, effRm - i.basePrice);
    return {
      product_id: i.productId ?? "",
      quantity: qty,
      unit_price_sen: Math.round(i.basePrice * 100),
      modifier_total_sen: Math.round(modRm * 100),
      category: i.category ?? null,
      category_id: null,
      name: "",
    };
  });
  const { discount_sen } = computeVoucherDiscount({ spec: toSpec(reward), cart });
  return discount_sen / 100; // sen → RM (cart/checkout views work in RM)
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
  if (r.discount_type === "free_upgrade") {
    return "Free upgrade";
  }
  if (r.discount_type === "bogo") {
    return `Buy ${r.bogo_buy_qty} get ${r.bogo_free_qty} free`;
  }
  if (r.discount_type === "combo") {
    return r.combo_price_sen != null
      ? `Combo · RM${(r.combo_price_sen / 100).toFixed(2).replace(/\.00$/, "")}`
      : "Combo deal";
  }
  if (r.discount_type === "override_price") {
    return r.override_price_sen != null
      ? `RM${(r.override_price_sen / 100).toFixed(2).replace(/\.00$/, "")} each`
      : "Special price";
  }
  return "Reward";
}
