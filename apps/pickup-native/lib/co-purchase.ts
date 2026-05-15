import { supabase } from "./supabase";

/**
 * "What do customers actually buy together?" — backed by the
 * product_co_purchase_scores materialized view, fed by 12 months of
 * StoreHub POS baskets (~5.7k multi-item baskets, 96% name-matched
 * to the products catalog). Refreshed nightly.
 *
 * This is the data signal that ranks the Pair With section once the
 * combo-eligible items have taken the top slots. Combo first because
 * it's a real money-saving deal; co-purchase next because it's the
 * historically-validated next-best suggestion; category fallback
 * last for products that have no co-purchase history yet.
 */

export type CoPurchaseScore = {
  paired_with: string;  // product id
  co_count: number;     // # baskets the pair co-occurred in
};

/** Top-N products historically bought together with the given product.
 *  Returns empty array on RPC failure or for products with no signal —
 *  caller should fall back to category-based selection in that case. */
export async function fetchCoPurchasedProducts(
  productId: string,
  limit = 20,
): Promise<CoPurchaseScore[]> {
  if (!productId) return [];
  const { data, error } = await supabase.rpc("get_co_purchased_products", {
    for_product_id: productId,
    limit_count: limit,
  });
  if (error) {
    console.warn("[co-purchase] rpc failed", error);
    return [];
  }
  return (data ?? []) as CoPurchaseScore[];
}
