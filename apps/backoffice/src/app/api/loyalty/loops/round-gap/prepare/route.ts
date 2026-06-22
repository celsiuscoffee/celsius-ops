import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/loyalty/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Curated round-gap campaigns per the office-hours design (docs/design/
// personalised-round-gap-loop.md). Offer = low-COGS "free coffee + min spend"
// (free_item gated by min_order_value) — NOT a discount; the basket carries the
// ~RM3 coffee COGS, so it's margin-safe and lifts AOV.
//
// PERSONALISED + CURATED PER SEGMENT. The audience (segment v3) is the outlet's
// behavioral round-skippers PLUS its dormant imported StoreHub base that never
// ordered native (~15k tagged Putrajaya / Shah Alam). Each run is capped at
// `limit` (default 100, the "100/day" reactivation drip) taking the warmest
// slice first. Each of those two groups gets its OWN arm — its own copy AND its
// own offer:
//   • rg_skipper — a warm regular who skips this round. Goal: shift them into the
//     round + push AOV → higher bar (Conezion RM35 / Shah Alam RM40, ~20% above
//     the round's AOV).
//   • rg_import  — a dormant customer we're winning back. Goal: just get the
//     first native order → easier bar (RM25, near the overall median).
// Copy uses {name} (substituted to the member's first name at send time). The
// prepare RPC tags each arm's members, auto-creates one time-boxed, tag-gated,
// outlet-scoped promo PER ARM at that arm's min_order, and records the round
// 'prepared'. Operator reviews + sends from the round card (no SMS here).
// measureRound reads skipper-vs-import lift separately via the arm.
const DAILY_LIMIT = 100;
type Arm = { key: "rg_skipper" | "rg_import"; label: string; message: string; min_order: number };
const CAMPAIGNS: Record<string, {
  outlet: string; round_start: number; round_end: number; name: string; limit: number; arms: Arm[];
}> = {
  "conezion-breakfast": {
    outlet: "conezion", round_start: 7, round_end: 9, name: "Conezion · Breakfast", limit: DAILY_LIMIT,
    arms: [
      { key: "rg_skipper", min_order: 35, label: "Regular · free coffee, spend RM35 (7-9am)",
        message: "Hi {name}! Free coffee at Celsius Conezion breakfast (7-9am) this week, spend RM35. We miss you in the AM! Show your number." },
      { key: "rg_import", min_order: 25, label: "Win-back · free coffee, spend RM25 (7-9am)",
        message: "Hi {name}! We miss you at Celsius Conezion. Free coffee at breakfast (7-9am) this week, spend RM25. Show your number." },
    ],
  },
  "shah-alam-evening": {
    outlet: "shah-alam", round_start: 17, round_end: 19, name: "Shah Alam · Evening", limit: DAILY_LIMIT,
    arms: [
      { key: "rg_skipper", min_order: 40, label: "Regular · free coffee, spend RM40 (5-7pm)",
        message: "Hi {name}! Free coffee at Celsius Shah Alam (5-7pm) this week, spend RM40. We rarely see you in the evening! Show your number." },
      { key: "rg_import", min_order: 25, label: "Win-back · free coffee, spend RM25 (5-7pm)",
        message: "Hi {name}! We miss you at Celsius Shah Alam. Free coffee (5-7pm) this week, spend RM25. Show your number." },
    ],
  },
};

// POST /api/loyalty/loops/round-gap/prepare  { campaign: "conezion-breakfast" }
// Admin-gated. Creates a 'prepared' round-gap round (segment + per-arm tag +
// per-arm auto-promo). Does NOT send — review + approve the round to fire the SMS.
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
      p_arms: cfg.arms,
      p_limit: cfg.limit,
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
      promos: row.promos,
      message: `Prepared ${cfg.name}: ${row.treated} treated + ${row.holdout} holdout. Review the round below, then Send to fire the SMS.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to prepare round-gap";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
