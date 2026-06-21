import { NextRequest, NextResponse } from "next/server";
import { bestCartChallenge, type CartLine } from "@/lib/loyalty/cart-challenge";

// POST /api/loyalty/me/cart-challenge
// Body: { member: loyaltyId, items: [{ product_id, quantity, total_sen }] }
//
// Returns the single best AOV challenge to nudge for this member + basket:
// "Spend RM12 more to unlock Free Coffee" / "Add a bite to unlock Free Tea".
// Drives bigger baskets at the decision moment. Null when nothing's close.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const member = typeof body?.member === "string" ? body.member : null;
    const items: CartLine[] = Array.isArray(body?.items)
      ? body.items
          .filter((x: unknown): x is { product_id: string; quantity?: unknown; total_sen?: unknown } =>
            !!x && typeof (x as { product_id?: unknown }).product_id === "string")
          .map((x: { product_id: string; quantity?: unknown; total_sen?: unknown }) => ({
            product_id: x.product_id,
            quantity: Number(x.quantity) || 1,
            total_sen: Number(x.total_sen) || 0,
          }))
      : [];
    const challenge = await bestCartChallenge(member, items);
    return NextResponse.json({ challenge });
  } catch (err) {
    console.error("[cart-challenge] route error:", err);
    return NextResponse.json({ challenge: null }, { status: 200 });
  }
}
