import { NextRequest, NextResponse } from "next/server";
import { suggestPairs, logPairImpressions } from "@celsius/shared";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { triedProductIds } from "@/lib/poster/select-home";

// POST /api/suggest-pairs  — in-cart upsell ("Goes well with your order").
// Body: { cart_product_ids: string[], member?: string, outlet_id?: string }
//
// Thin wrapper over the SHARED pairing engine (@celsius/shared suggestPairs),
// the SAME engine behind the in-store "Pair with a Bite" — here with
// channel:"pickup" (online menu) and the member's regulars passed as "usual"
// so the suggestions personalise. Returns a cart-ready shape for _CartUpsell.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const cartIds: string[] = Array.isArray(body?.cart_product_ids)
      ? body.cart_product_ids.filter((x: unknown): x is string => typeof x === "string")
      : [];
    if (!cartIds.length) return NextResponse.json({ pairs: [] });
    const memberId: string | null = typeof body?.member === "string" ? body.member : null;
    const outletId: string | null = typeof body?.outlet_id === "string" ? body.outlet_id : null;

    const supabase = getSupabaseAdmin();
    const tried = await triedProductIds(supabase, memberId);

    const { pairs } = await suggestPairs({
      supabase,
      cartProductIds: cartIds,
      usualProductIds: [...tried],
      outletId,
      channel: "pickup",
    });
    // Attach-rate denominator for the pickup cart rail (_CartUpsell renders
    // nothing when pairs is empty, so an impression here ≈ a render).
    if (pairs.length) {
      void logPairImpressions(supabase, pairs, { outletId, source: "pickup" });
    }

    // Cart-ready shape for the rail (RM price, image, optional deal badge).
    return NextResponse.json({
      pairs: pairs.map((p) => ({
        id: p.product_id,
        name: p.name,
        basePrice: p.price_sen / 100,
        image: p.image_url,
        reason: p.reason,
        discountLabel: p.discount_label,
      })),
    });
  } catch (err) {
    console.error("[suggest-pairs] error:", err);
    return NextResponse.json({ pairs: [] }, { status: 200 });
  }
}
