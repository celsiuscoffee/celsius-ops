// Shared, canonical "affordable catalog rewards" fetch — single source
// of truth used by BOTH apps/order (Pickup) and apps/pos. Replaces
// two divergent implementations: POS hit Supabase directly with a
// minimal filter set, Pickup proxied through loyalty.celsiuscoffee.com
// and then re-hydrated from Supabase with a different filter set
// (and merged in issued_rewards via a legacy rewards-table join that
// silently dropped modern voucher-template-backed rows).
//
// After this lands, both surfaces hit the rewards table directly and
// apply identical eligibility rules. The only knob is
// fulfillmentChannel — POS = "in_store" / null (no channel filter),
// Pickup = "pickup" (rewards must be tagged pickup-capable).

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

/** Raw rewards row shape — internal, do not export. */
type RawReward = {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  points_required: number;
  category: string;
  stock: number | null;
  image_url: string | null;
  reward_type: string | null;
  validity_days: number | null;
  max_redemptions_per_member: number | null;
  is_active: boolean;
  auto_issue: boolean | null;
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

/** Fetch affordable catalog rewards for a member. Filters applied:
 *    - brand_id = brandId
 *    - is_active = true
 *    - auto_issue = false (auto-issued rewards are surfaced via
 *      issued_rewards, not the public catalog)
 *    - points_required <= balance
 *    - stock is null or > 0
 *    - valid_from is null or <= now()
 *    - valid_until is null or > now()
 *    - max_redemptions_per_member is null or > member's current
 *      redemption count for that reward
 *    - if fulfillmentChannel is set: fulfillment_type is null
 *      (any channel) or includes the channel
 *
 *  Joins redemptions table to compute per-reward redemption count so
 *  the client can enforce per-member caps without an extra trip. */
export async function fetchAffordableCatalogForMember(args: {
  supabase: SupabaseClient;
  memberId: string;
  brandId?: string;
  balance: number;
  fulfillmentChannel?: "pickup" | "in_store" | null;
}): Promise<AffordableCatalogReward[]> {
  const brandId = args.brandId ?? "brand-celsius";

  const { data: rawRewards, error } = await args.supabase
    .from("rewards")
    .select(`
      id, brand_id, name, description, points_required, category, stock,
      image_url, reward_type, validity_days, max_redemptions_per_member,
      is_active, auto_issue,
      discount_type, discount_value, max_discount_value, min_order_value,
      applicable_products, applicable_categories,
      free_product_ids, free_product_name, bogo_buy_qty, bogo_free_qty,
      fulfillment_type, valid_from, valid_until
    `)
    .eq("brand_id", brandId)
    .eq("is_active", true)
    .order("points_required", { ascending: true });

  if (error) {
    throw new Error(`fetchAffordableCatalogForMember: ${error.message}`);
  }

  const rewards = ((rawRewards ?? []) as unknown as RawReward[])
    // Auto-issued rewards (welcome BOGO, birthday) are intentionally
    // excluded from the public points-shop list — they're surfaced
    // via issued_rewards once the system has granted them.
    .filter((r) => !r.auto_issue);

  // Bulk-fetch this member's redemption counts across the candidate
  // reward ids so we can enforce max_redemptions_per_member without
  // an extra trip per row.
  const rewardIds = rewards.map((r) => r.id);
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
  const eligible = rewards.filter((r) => {
    // Affordability
    if (r.points_required <= 0 || r.points_required > args.balance) return false;
    // Stock
    if (r.stock != null && r.stock <= 0) return false;
    // Validity window
    if (r.valid_from && new Date(r.valid_from).getTime() > nowMs) return false;
    if (r.valid_until && new Date(r.valid_until).getTime() < nowMs) return false;
    // Per-member cap
    if (
      r.max_redemptions_per_member != null &&
      (redemptionCounts.get(r.id) ?? 0) >= r.max_redemptions_per_member
    ) {
      return false;
    }
    // Channel
    if (args.fulfillmentChannel && Array.isArray(r.fulfillment_type) && r.fulfillment_type.length > 0) {
      if (!r.fulfillment_type.includes(args.fulfillmentChannel)) return false;
    }
    return true;
  });

  return eligible.map((r): AffordableCatalogReward => ({
    id: r.id,
    brand_id: r.brand_id,
    name: r.name,
    description: r.description,
    points_required: r.points_required,
    category: r.category,
    stock: r.stock,
    image_url: r.image_url,
    reward_type: r.reward_type ?? "voucher",
    validity_days: r.validity_days,
    max_redemptions_per_member: r.max_redemptions_per_member,
    is_active: true,
    discount_type: (r.discount_type as VoucherDiscountType | null) ?? null,
    discount_value: r.discount_value,
    max_discount_value: r.max_discount_value,
    min_order_value: r.min_order_value,
    applicable_products: r.applicable_products,
    applicable_categories: r.applicable_categories,
    free_product_ids: r.free_product_ids,
    free_product_name: r.free_product_name,
    bogo_buy_qty: r.bogo_buy_qty ?? 0,
    bogo_free_qty: r.bogo_free_qty ?? 0,
    fulfillment_type: r.fulfillment_type,
    valid_from: r.valid_from,
    valid_until: r.valid_until,
    redemption_count: redemptionCounts.get(r.id) ?? 0,
  }));
}
