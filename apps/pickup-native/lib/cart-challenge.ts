const API_BASE = "https://order.celsiuscoffee.com";

export type CartChallenge = {
  title: string;
  reward: string;
  message: string;
  met: boolean;
  progressPct: number;
};

// AOV challenge nudge for the cart — "Spend RM12 more to unlock Free Coffee".
// Hits the shared /api/loyalty/me/cart-challenge (same logic as web). Origin/
// Referer headers satisfy the API's CSRF guard (same pattern as posters.ts).
export async function fetchCartChallenge(
  items: { product_id: string; quantity: number; total_sen: number }[],
  member: string | null,
): Promise<CartChallenge | null> {
  if (!member || !items.length) return null;
  try {
    const res = await fetch(`${API_BASE}/api/loyalty/me/cart-challenge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: API_BASE,
        Referer: API_BASE + "/cart",
      },
      body: JSON.stringify({ member, items }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { challenge?: CartChallenge | null };
    return json.challenge ?? null;
  } catch {
    return null;
  }
}
