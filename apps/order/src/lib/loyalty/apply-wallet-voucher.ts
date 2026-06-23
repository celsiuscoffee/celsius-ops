// Shared "Use Now" mapping — writes a wallet voucher into the SPA's
// persisted state (localStorage "celsius-pickup") as the applied reward +
// reserved-voucher banner, so cart/checkout preview + charge it correctly.
//
// Extracted from the Rewards-tab voucher list so the home expiring-reward
// banner closes the loop the EXACT same way (no drift): both carry every
// discount mechanic (flat / percent / free_item / bogo / combo / override).

export type WalletVoucher = {
  id: string;
  title?: string | null;
  name?: string | null;
  category?: string | null;
  icon?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  max_discount_value?: number | null;
  applicable_categories?: string[] | null;
  applicable_products?: string[] | null;
  free_product_name?: string | null;
  free_product_ids?: string[] | null;
  min_order_value?: number | null;
  bogo_buy_qty?: number | null;
  bogo_free_qty?: number | null;
  combo_price_sen?: number | null;
  override_price_sen?: number | null;
  expires_at?: string | null;
};

export function applyWalletVoucherToState(v: WalletVoucher): void {
  try {
    const raw = window.localStorage.getItem("celsius-pickup");
    const parsed = raw ? JSON.parse(raw) : { state: {} };
    const state = parsed.state ?? {};
    // beans_multiplier is applied post-payment, never a cart discount.
    const discountType =
      v.discount_type && v.discount_type !== "beans_multiplier" ? v.discount_type : null;
    state.appliedReward = {
      id: v.id,
      name: v.title ?? v.name ?? "Reward",
      points_required: 0,
      discount_type: discountType,
      discount_value: v.discount_value ?? null,
      max_discount_value: v.max_discount_value ?? null,
      applicable_categories: v.applicable_categories ?? null,
      applicable_products: v.applicable_products ?? null,
      free_product_name: v.free_product_name ?? null,
      free_product_ids: v.free_product_ids ?? null,
      min_order_value: v.min_order_value ?? null,
      bogo_buy_qty: v.bogo_buy_qty ?? undefined,
      bogo_free_qty: v.bogo_free_qty ?? undefined,
      combo_price_sen: v.combo_price_sen ?? null,
      override_price_sen: v.override_price_sen ?? null,
      voucher_id: v.id, // marks this as a wallet voucher (issued_rewards burn)
    };
    state.reservedVoucher = {
      id: v.id,
      title: v.title ?? v.name ?? "Reward",
      category: v.category ?? "special",
      icon: v.icon ?? "ticket",
      expires_at: v.expires_at ?? null,
    };
    window.localStorage.setItem("celsius-pickup", JSON.stringify({ ...parsed, state }));
  } catch {
    /* ignore */
  }
}
