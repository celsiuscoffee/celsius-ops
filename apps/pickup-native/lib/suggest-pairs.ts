const API_BASE = "https://order.celsiuscoffee.com";

export type CartPair = {
  id: string;
  name: string;
  basePrice: number;
  image: string | null;
  reason: string;
  discountLabel: string | null;
};

// In-cart upsell ("Goes well with your order"). Calls the SAME shared pairing
// engine the web cart + in-store POS use (channel "pickup"), so suggestions
// stay consistent across surfaces. Origin/Referer headers satisfy the API's
// CSRF guard (same pattern as posters.ts).
export async function fetchCartPairs(
  productIds: string[],
  member: string | null,
  outletId: string | null,
): Promise<CartPair[]> {
  if (!productIds.length) return [];
  try {
    const res = await fetch(`${API_BASE}/api/suggest-pairs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: API_BASE,
        Referer: API_BASE + "/cart",
      },
      body: JSON.stringify({ cart_product_ids: productIds, member, outlet_id: outletId }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { pairs?: CartPair[] };
    return json.pairs ?? [];
  } catch {
    return [];
  }
}
