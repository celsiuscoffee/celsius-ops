import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/loyalty/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Curated round-gap campaigns per the office-hours design (docs/design/
// personalised-round-gap-loop.md). Offer = low-COGS "free coffee when you spend
// RM20+" (free_item gated by min_order_value) — NOT a discount, and the RM20
// basket forces a real order beyond a lone coffee (food attach) at the weak
// round. Margin-safe: the give is ~RM3 coffee COGS, carried by the basket. Each
// keeps a 10% holdout. The prepare RPC tags the treatment group + auto-creates
// the time-boxed, tag-restricted, outlet-scoped promo. Status 'prepared' → the
// operator reviews + sends from the round card (no SMS here).
const CAMPAIGNS: Record<string, {
  outlet: string; round_start: number; round_end: number;
  name: string; offer_label: string; message: string;
}> = {
  "conezion-breakfast": {
    outlet: "conezion", round_start: 7, round_end: 9,
    name: "Conezion · Breakfast", offer_label: "Free coffee when you spend RM20+ (7–9am)",
    message: "Free coffee with breakfast at Celsius Conezion, 7-9am this week. Spend RM20+ and your coffee's on us. Show your number to redeem.",
  },
  "shah-alam-evening": {
    outlet: "shah-alam", round_start: 17, round_end: 19,
    name: "Shah Alam · Evening", offer_label: "Free coffee when you spend RM20+ (5–7pm)",
    message: "Free coffee at Celsius Shah Alam, 5-7pm this week. Spend RM20+ and your coffee's on us. Show your number to redeem.",
  },
};

// POST /api/loyalty/loops/round-gap/prepare  { campaign: "conezion-breakfast" }
// Admin-gated. Creates a 'prepared' round-gap round (segment + tag + auto-promo).
// Does NOT send — review + approve the round to fire the SMS.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const cfg = CAMPAIGNS[body?.campaign as string];
    if (!cfg) {
      return NextResponse.json({ error: `Unknown campaign. Options: ${Object.keys(CAMPAIGNS).join(", ")}` }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.rpc("loyalty_round_gap_prepare", {
      p_outlet: cfg.outlet,
      p_round_start: cfg.round_start,
      p_round_end: cfg.round_end,
      p_round_name: cfg.name,
      p_offer_label: cfg.offer_label,
      p_message: cfg.message,
    });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.round_id) {
      return NextResponse.json({ prepared: false, message: "No eligible customers right now — nothing prepared." });
    }
    return NextResponse.json({
      prepared: true,
      round_id: row.round_id,
      treated: row.treated,
      holdout: row.holdout,
      promo_id: row.promo_id,
      member_tag: row.member_tag,
      message: `Prepared ${cfg.name}: ${row.treated} treated + ${row.holdout} holdout. Review the round below, then Send to fire the SMS.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to prepare round-gap";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
