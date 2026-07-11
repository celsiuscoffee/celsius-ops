import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * POST /api/pair-tap — pickup-cart upsell engagement.
 *
 * The "Goes well with your order" rail links to the product page rather than
 * adding directly, so a card tap is the strongest signal this surface emits
 * (the eventual add shows up as an order_items.is_pair line, counted by the
 * sales dashboard). Logged as event_type='tap' in pos_pair_events alongside
 * the server-logged impressions, giving the rail a tap-through rate.
 *
 * Mirrors /api/poster-tap: best-effort, never throws, never blocks the tap.
 */

export const dynamic = "force-dynamic";

const ROUNDS: { key: string; s: number; e: number }[] = [
  { key: "breakfast", s: 8, e: 10 }, { key: "brunch", s: 10, e: 12 }, { key: "lunch", s: 12, e: 15 },
  { key: "midday", s: 15, e: 17 }, { key: "evening", s: 17, e: 19 }, { key: "dinner", s: 19, e: 21 },
  { key: "supper", s: 21, e: 23 },
];
function currentRound(): string | null {
  const h = (new Date().getUTCHours() + 8) % 24; // MYT
  return ROUNDS.find((r) => h >= r.s && h < r.e)?.key ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      productId?: string; productName?: string; reason?: string; rank?: number; outletId?: string;
    };
    if (!body?.productId) return NextResponse.json({ ok: false }, { status: 200 });

    const supabase = getSupabaseAdmin();
    await supabase.from("pos_pair_events").insert({
      outlet_id: typeof body.outletId === "string" ? body.outletId : null,
      round: currentRound(),
      product_id: body.productId,
      product_name: typeof body.productName === "string" ? body.productName : null,
      reason: typeof body.reason === "string" ? body.reason : null,
      rank: typeof body.rank === "number" ? body.rank : null,
      source: "pickup",
      event_type: "tap",
    } as Record<string, unknown>);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
