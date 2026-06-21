import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { suggestPairs } from "@celsius/shared";

/**
 * POST /api/pos/loyalty/suggest-pairs
 * Body: { outlet_id?, cart_product_ids: string[], usual_product_ids?: string[] }
 *
 * The in-store "Pair with a Bite" surface (POS customer display + register).
 * Thin wrapper over the SHARED pairing engine (@celsius/shared suggestPairs) —
 * the same engine powers the customer app's in-cart upsell (channel:"pickup"),
 * so the two never drift and the nightly weight tuner moves both at once.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { pairs, round } = await suggestPairs({
      supabase,
      cartProductIds: Array.isArray(body?.cart_product_ids) ? body.cart_product_ids : [],
      usualProductIds: Array.isArray(body?.usual_product_ids) ? body.usual_product_ids : [],
      outletId: body?.outlet_id ?? null,
      channel: "pos",
    });
    return NextResponse.json({ pairs, round });
  } catch (err) {
    console.error("[pos/loyalty/suggest-pairs] error:", err);
    return NextResponse.json({ pairs: [], round: null });
  }
}
