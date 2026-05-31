// Shared, canonical "affordable catalog rewards" fetch — single source
// of truth used by BOTH apps/order (Pickup) and apps/pos. Replaces
// two divergent implementations: POS hit Supabase directly with a
// minimal filter set, Pickup proxied through loyalty.celsiuscoffee.com
// and then re-hydrated from Supabase with a different filter set
// (and merged in issued_rewards via a legacy rewards-table join that
// silently dropped modern voucher-template-backed rows).
//
// After this lands, both surfaces hit voucher_templates directly (rows
// with points_cost set) and apply identical eligibility rules. The only
// knob is fulfillmentChannel — POS = "in_store" / null (no channel
// filter), Pickup = "pickup" (rewards must be tagged pickup-capable).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { VoucherDiscountType } from "./active-vouchers";

/** Canonical catalog reward shape. Used by BOTH POS and Pickup catalog
 *  surfaces. Distinct from ActiveVoucher: catalog rewards are
 *  bean-priced options the member can REDEEM (not yet owned).
 *  Once redeemed, an issued_rewards row is created and that becomes
 *  an ActiveVoucher on subsequent fetches. */
export type AffordableCatalogReward = {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  points_required: number;
  category: string;
  stock: number | null;
  image_url: string | null;
  reward_type: string;
  validity_days: number | null;
  max_redemptions_per_member: number | null;
  /** Always true on rows this helper returns (it filters by is_active);
   *  surfaced as a field for backward compat with existing clients
   *  whose Reward types still expect it. */
  is_active: true;
  /** Discount mechanics — drive the checkout discount engine */
  discount_type: VoucherDiscountType | null;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  bogo_buy_qty: number;
  bogo_free_qty: number;
  /** Channels this reward can be redeemed on. Null = any. */
  fulfillment_type: string[] | null;
  valid_from: string | null;
  valid_until: string | null;
  /** How many times THIS member has redeemed this reward already.
   *  Drives the max_redemptions_per_member cap. */
  redemption_count: number;
};

/** Raw voucher_templates row shape (Bean-Shop catalog mirror) —
 *  internal, do not export.
 *
 *  Commit 3 of the rewards refactor: the catalog now reads from
 *  voucher_templates (rows where points_cost IS NOT NULL), not the
 *  legacy `rewards` table. The redeem/mint flow now reads
 *  voucher_templates too (resolving by `legacy_reward_id`); the
 *  `rewards` table is no longer read on any redemption path. The
 *  AffordableCatalogReward.id returned to clients stays the legacy id
 *  (issued_rewards.reward_id + redemptions.reward_id remain legacy-keyed
 *  during the grace window), unchanged from before. */
type RawTemplate = {
  id: string;
  legacy_reward_id: string | null;
  brand_id: string;
  title: string;
  description: string | null;
  points_cost: number;
  category: string;
  stock: number | null;
  image_url: string | null;
  validity_days: number | null;
  max_per_member: number | null;
  is_active: boolean;
  discount_type: string | null;
  discount_value: number | null;
  max_discount_value: number | null;
  min_order_value: number | null;
  applicable_products: string[] | null;
  applicable_categories: string[] | null;
  free_product_ids: string[] | null;
  free_product_name: string | null;
  bogo_buy_qty: number | null;
  bogo_free_qty: number | null;
  fulfillment_type: string[] | null;
  valid_from: string | null;
  valid_until: string | null;
};

/** Fetch affordable catalog rewards for a member. Reads the Bean-Shop
 *  catalog from voucher_templates (rows with points_cost set) — the
 *  canonical source after Commit 3. Filters applied:
 *    - brand_id = brandId
 *    - is_active = true
 *    - points_cost IS NOT NULL  (i.e. this template is a points-shop item)
 *    - points_cost <= balance
 *    - stock is null or > 0
 *    - valid_from is null or <= now()
 *    - valid_until is null or > now()
 *    - max_per_member is null or > member's current redemption count
 *    - if fulfillmentChannel is set: fulfillment_type is null
 *      (any channel) or includes the channel
 *
 *  The returned `id` is the template's legacy_reward_id (the original
 *  'reward-X' text id) so the redeem/mint flow — which now resolves
 *  voucher_templates by legacy_reward_id — keeps working. Falls back to
 *  the template UUID if a mirror somehow lacks legacy_reward_id.
 *
 *  Joins redemptions table (keyed by the legacy reward_id) to compute
 *  per-reward redemption count for max_per_member enforcement. */
export async function fetchAffordableCatalogForMember(args: {
  supabase: SupabaseClient;
  memberId: string;
  brandId?: string;
  balance: number;
  fulfillmentChannel?: "pickup" | "in_store" | null;
}): Promise<AffordableCatalogReward[]> {
  const brandId = args.brandId ?? "brand-celsius";

  const { data: rawTemplates, error } = await args.supabase
    .from("voucher_templates")
    .select(`
      id, legacy_reward_id, brand_id, title, description, points_cost, category, stock,
      image_url, validity_days, max_per_member, is_active,
      discount_type, discount_value, max_discount_value, min_order_value,
      applicable_products, applicable_categories,
      free_product_ids, free_product_name, bogo_buy_qty, bogo_free_qty,
      fulfillment_type, valid_from, valid_until
    `)
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .not("points_cost", "is", null)
    .order("points_cost", { ascending: true });

  if (error) {
    throw new Error(`fetchAffordableCatalogForMember: ${error.message}`);
  }

  const templates = (rawTemplates ?? []) as unknown as RawTemplate[];

  // The id we expose to clients is the legacy reward id (for redeem
  // compatibility). Redemption counts are keyed on that same id.
  const publicId = (t: RawTemplate): string => t.legacy_reward_id ?? t.id;

  // Bulk-fetch this member's redemption counts across the candidate
  // reward ids so we can enforce max_per_member without a trip per row.
  const rewardIds = templates.map(publicId);
  const redemptionCounts = new Map<string, number>();
  if (rewardIds.length > 0) {
    const { data: redemptions } = await args.supabase
      .from("redemptions")
      .select("reward_id")
      .eq("member_id", args.memberId)
      .in("reward_id", rewardIds);
    for (const row of (redemptions ?? []) as { reward_id: string }[]) {
      redemptionCounts.set(row.reward_id, (redemptionCounts.get(row.reward_id) ?? 0) + 1);
    }
  }

  const nowMs = Date.now();
  const eligible = templates.filter((t) => {
    // Affordability
    if (t.points_cost <= 0 || t.points_cost > args.balance) return false;
    // Stock
    if (t.stock != null && t.stock <= 0) return false;
    // Validity window
    if (t.valid_from && new Date(t.valid_from).getTime() > nowMs) return false;
    if (t.valid_until && new Date(t.valid_until).getTime() < nowMs) return false;
    // Per-member cap
    if (
      t.max_per_member != null &&
      (redemptionCounts.get(publicId(t)) ?? 0) >= t.max_per_member
    ) {
      return false;
    }
    // Channel
    if (args.fulfillmentChannel && Array.isArray(t.fulfillment_type) && t.fulfillment_type.length > 0) {
      if (!t.fulfillment_type.includes(args.fulfillmentChannel)) return false;
    }
    return true;
  });

  return eligible.map((t): AffordableCatalogReward => ({
    id: publicId(t),                       // legacy reward id for redeem compat
    brand_id: t.brand_id,
    name: t.title,
    description: t.description,
    points_required: t.points_cost,
    category: t.category,
    stock: t.stock,
    image_url: t.image_url,
    reward_type: "voucher",
    validity_days: t.validity_days,
    max_redemptions_per_member: t.max_per_member,
    is_active: true,
    discount_type: (t.discount_type as VoucherDiscountType | null) ?? null,
    discount_value: t.discount_value,
    max_discount_value: t.max_discount_value,
    min_order_value: t.min_order_value,
    applicable_products: t.applicable_products,
    applicable_categories: t.applicable_categories,
    free_product_ids: t.free_product_ids,
    free_product_name: t.free_product_name,
    bogo_buy_qty: t.bogo_buy_qty ?? 0,
    bogo_free_qty: t.bogo_free_qty ?? 0,
    fulfillment_type: t.fulfillment_type,
    valid_from: t.valid_from,
    valid_until: t.valid_until,
    redemption_count: redemptionCounts.get(publicId(t)) ?? 0,
  }));
}
