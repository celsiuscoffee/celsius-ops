import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { suggestPairs, logPairImpressions } from "@celsius/shared";

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

    // The POS apps (register + customer display) send the LOYALTY outlet id,
    // but the shared engine's "86" overlay reads outlet_product_availability,
    // which is keyed by STORE SLUG (e.g. "shah-alam"). Resolve loyalty id →
    // store slug here so snoozed items are actually dropped from suggestions —
    // otherwise an item hidden from the menu still surfaces in "Pair with a
    // Bite" and the customer can order it. Falls back to the raw id if the
    // outlet can't be resolved (preserves combo outlet-targeting, which stores
    // both keys). The slug also matches combo outlet_ids, same as the web path.
    const loyaltyOutletId: string | null = body?.outlet_id ?? null;
    let outletId = loyaltyOutletId;
    if (loyaltyOutletId) {
      const { data: os } = await supabase
        .from("outlet_settings")
        .select("store_id")
        .eq("loyalty_outlet_id", loyaltyOutletId)
        .maybeSingle();
      const storeId = (os as { store_id?: string } | null)?.store_id;
      if (storeId) outletId = storeId;
    }

    const { pairs, round } = await suggestPairs({
      supabase,
      cartProductIds: Array.isArray(body?.cart_product_ids) ? body.cart_product_ids : [],
      usualProductIds: Array.isArray(body?.usual_product_ids) ? body.usual_product_ids : [],
      outletId,
      channel: "pos",
    });
    // Attach-rate denominator: log the suggestions we just SHOWED. Server-side
    // so both POS surfaces are covered without a native-app update; clients
    // that identify themselves pass source:'display', the rest default to the
    // register (the dominant caller today). Fire-and-forget.
    if (pairs.length) {
      void logPairImpressions(supabase, pairs, {
        outletId: loyaltyOutletId,
        source: body?.source === "display" ? "display" : "register",
      });
    }
    return NextResponse.json({ pairs, round });
  } catch (err) {
    console.error("[pos/loyalty/suggest-pairs] error:", err);
    return NextResponse.json({ pairs: [], round: null });
  }
}
