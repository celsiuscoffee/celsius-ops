// Shared discount-spec + engine-cart helpers. Canonical home (moved here
// from apps/order/src/lib/loyalty/discount-spec.ts) so EVERY server-side
// redemption route — apps/order /api/orders + /api/checkout/initiate AND
// apps/backoffice POS /api/pos/loyalty/* — builds the engine spec + cart
// identically via @celsius/shared. No per-app drift.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { VoucherDiscountSpec, DiscountCartLine } from "./discount-engine";

/** The canonical discount-mechanics columns on voucher_templates — the
 *  full set the shared engine needs to compute any of the 9 types. */
export const DISCOUNT_SPEC_COLUMNS =
  "discount_type, discount_value, max_discount_value, min_order_value, " +
  "applicable_categories, applicable_products, free_product_ids, free_product_name, " +
  "bogo_buy_qty, bogo_free_qty, combo_price_sen, override_price_sen";

export type DiscountSpecRow = {
  discount_type: string | null;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  combo_price_sen: number | null;
  override_price_sen: number | null;
};

/** Build the sen-based engine spec from a voucher_templates row. All
 *  money fields on the row are already SEN — discount_value(flat),
 *  max_discount_value, min_order_value, combo_price_sen,
 *  override_price_sen — so they pass straight through (no ×100).
 *  discount_value(percent) is a raw percentage. */
export function rowToDiscountSpec(t: DiscountSpecRow): VoucherDiscountSpec {
  return {
    discount_type: (t.discount_type as VoucherDiscountSpec["discount_type"]) ?? null,
    discount_value: t.discount_value,
    max_discount_value_sen: t.max_discount_value,
    // min_order_value is SEN (e.g. "RM15+" = 1500), same as
    // max_discount_value — NOT RM. The earlier ×100 made min-order
    // rewards require ~100× the intended minimum and never fire.
    min_order_value_sen: t.min_order_value != null ? Number(t.min_order_value) : null,
    applicable_categories: t.applicable_categories,
    applicable_products: t.applicable_products,
    free_product_ids: t.free_product_ids,
    free_product_name: t.free_product_name,
    bogo_buy_qty: t.bogo_buy_qty,
    bogo_free_qty: t.bogo_free_qty,
    combo_price_sen: t.combo_price_sen,
    override_price_sen: t.override_price_sen,
  };
}

/** The denormalized inline discount columns carried on an issued_rewards
 *  row. A subset of the template mechanics — max_discount_value /
 *  free_product_ids / bogo·combo·override live ONLY on voucher_templates,
 *  so they're absent here (callers that need them must prefer the linked
 *  template via voucher_template_id). */
export type IssuedRewardInlineSpec = {
  discount_type: string | null;
  discount_value: number | null;
  min_order_value: number | null;
  applicable_categories: string[] | null;
  applicable_products: string[] | null;
  free_product_name: string | null;
};

/** Build the engine spec from an issued_rewards row's inline columns.
 *  Used for legacy vouchers minted before the voucher_template link
 *  existed; the template-only mechanics are null here (matches
 *  active-vouchers.ts). Money fields are SEN, same as voucher_templates. */
export function inlineSpecFromIssued(v: IssuedRewardInlineSpec): VoucherDiscountSpec {
  return {
    discount_type: (v.discount_type as VoucherDiscountSpec["discount_type"]) ?? null,
    discount_value: v.discount_value ?? null,
    max_discount_value_sen: null,
    min_order_value_sen: v.min_order_value != null ? Number(v.min_order_value) : null,
    applicable_categories: v.applicable_categories ?? null,
    applicable_products: v.applicable_products ?? null,
    free_product_ids: null,
    free_product_name: v.free_product_name ?? null,
    bogo_buy_qty: null,
    bogo_free_qty: null,
    combo_price_sen: null,
    override_price_sen: null,
  };
}

/** The discount DESCRIPTOR shape the POS register consumes. The register
 *  is client-authoritative — it applies this spec to its on-screen cart
 *  itself (the redeem route has no cart, so it can't call the engine).
 *  All money fields are SEN, matching the canonical spec. */
export type RegisterDiscountDescriptor = {
  type: string | null;
  value: number;
  max_discount: number | null;
  min_order: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  combo_price_sen: number | null;
  override_price_sen: number | null;
};

/** Project a canonical VoucherDiscountSpec → the POS register descriptor.
 *  Lossless + unit-preserving (spec money fields are already SEN). This is
 *  the SAME spec every other channel computes from, so POS, native, and
 *  QR-table never disagree on a reward's mechanics. Replaces the old
 *  name-parsing buildDiscountInfo (which leaked RM-vs-SEN on its dead
 *  legacy branch). max_discount / min_order coalesce 0→null to preserve
 *  "no cap / no minimum" semantics. */
export function specToRegisterDescriptor(spec: VoucherDiscountSpec): RegisterDiscountDescriptor {
  return {
    type: spec.discount_type ?? null,
    value: spec.discount_value ?? 0,
    max_discount: spec.max_discount_value_sen || null,
    min_order: spec.min_order_value_sen || null,
    applicable_products: spec.applicable_products ?? null,
    applicable_categories: spec.applicable_categories ?? null,
    free_product_ids: spec.free_product_ids ?? null,
    free_product_name: spec.free_product_name ?? null,
    bogo_buy_qty: spec.bogo_buy_qty ?? null,
    bogo_free_qty: spec.bogo_free_qty ?? null,
    combo_price_sen: spec.combo_price_sen ?? null,
    override_price_sen: spec.override_price_sen ?? null,
  };
}

type RawOrderItem = {
  product?: { id?: string; name?: string };
  productId?: string;
  product_id?: string;
  quantity: number;
  basePrice?: number;
  totalPrice?: number;
};

/** Build sen-based engine cart lines from incoming order items.
 *  unit_price_sen uses the BASE price (modifier upcharges stay paid —
 *  matches the established "free drink covers the base only" rule);
 *  modifier_total_sen carries the upcharge (currently unused by any
 *  discount rule — free_upgrade was removed). Resolves each line's category from the products table only
 *  when the spec filters by category (product filters match on id). */
export async function buildEngineCart(
  supabase: SupabaseClient,
  items: unknown,
  resolveCategories: boolean,
): Promise<DiscountCartLine[]> {
  const lines: DiscountCartLine[] = (items as RawOrderItem[]).map((i) => {
    const pid = i.product?.id ?? i.productId ?? i.product_id ?? "";
    const qty = Math.max(1, i.quantity);
    const effRm = (i.totalPrice ?? 0) / qty; // per-unit, incl modifiers
    const unitRm = i.basePrice != null ? i.basePrice : effRm;
    const modRm = i.basePrice != null ? Math.max(0, effRm - i.basePrice) : 0;
    return {
      product_id: pid,
      quantity: qty,
      unit_price_sen: Math.round(unitRm * 100),
      modifier_total_sen: Math.round(modRm * 100),
      category: null,
      category_id: null,
      name: i.product?.name ?? "",
    };
  });
  if (resolveCategories) {
    const ids = Array.from(new Set(lines.map((l) => l.product_id).filter((x): x is string => !!x)));
    if (ids.length) {
      const { data } = await supabase.from("products").select("id, category").in("id", ids);
      const byId = new Map(
        ((data ?? []) as Array<{ id: string; category: string | null }>).map((p) => [p.id, p.category]),
      );
      for (const l of lines) l.category = byId.get(l.product_id) ?? null;
    }
  }
  return lines;
}
