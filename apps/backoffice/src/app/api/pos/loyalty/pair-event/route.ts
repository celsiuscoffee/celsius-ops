import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/pos/loyalty/pair-event
 * Body: { outlet_id?, product_id, product_name?, reason?, rank?, source? }
 *
 * Upsell attribution — fired (best-effort) by the POS when a cashier/customer
 * ADDS a "Pair with a Bite" suggestion. One row per add → lets us measure the
 * success rate (pair-adds ÷ orders) by round/reason/outlet and, eventually,
 * tune the pairing weights toward what actually converts. The round is computed
 * here so the client never has to know the day-part.
 */

const ROUNDS: { key: string; startH: number; endH: number }[] = [
  { key: "breakfast", startH: 8, endH: 10 }, { key: "brunch", startH: 10, endH: 12 },
  { key: "lunch", startH: 12, endH: 15 }, { key: "midday", startH: 15, endH: 17 },
  { key: "evening", startH: 17, endH: 19 }, { key: "dinner", startH: 19, endH: 21 },
  { key: "supper", startH: 21, endH: 23 },
];
function currentRoundKey(): string | null {
  const h = (new Date().getUTCHours() + 8) % 24; // KL time (UTC+8)
  return ROUNDS.find((r) => h >= r.startH && h < r.endH)?.key ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const product_id: string | null = body?.product_id ?? null;
    if (!product_id) return NextResponse.json({ ok: false }, { status: 200 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    await supabase.from("pos_pair_events").insert({
      outlet_id: body?.outlet_id ?? null,
      round: currentRoundKey(),
      product_id,
      product_name: body?.product_name ?? null,
      reason: body?.reason ?? null,
      rank: typeof body?.rank === "number" ? body.rank : null,
      source: body?.source === "display" ? "display" : "register",
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Attribution must never break the order flow.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
