import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/loyalty/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Curated round-gap campaigns per the office-hours design (docs/design/
// personalised-round-gap-loop.md). Offer = low-COGS "free coffee when you spend
// RM<min>+" (free_item gated by min_order_value) — NOT a discount. The min is
// anchored ~20% ABOVE each round's own AOV (NOT below it), so the free coffee is
// the lever that pulls the basket UP toward the RM40 target — the original
// "lift this round 20%" objective. Below-AOV would just leak margin on baskets
// people already make. Margin-safe: the give is ~RM3 coffee COGS, carried by the
// larger basket. Each keeps a 10% holdout. The prepare RPC tags the treatment
// group + auto-creates the time-boxed, tag-restricted, outlet-scoped promo.
// Status 'prepared' → the operator reviews + sends from the round card.
//
// Thresholds (60-day data): Conezion Breakfast AOV RM29 → RM35 (+20%); Shah Alam
// Evening AOV RM33 → RM40 (+21%, lands on target). Retune as AOV moves.
//
// AUDIENCE (segment v3): the behavioral round-skippers PLUS the dormant imported
// StoreHub base for the outlet that never ordered native (~15k tagged Putrajaya /
// Shah Alam). Each run is capped at `limit` (default 100) and takes the warmest
// slice first — skippers, then StoreHub-tier imports, then points, then the rest
// — so this doubles as the "100/day" reactivation drip that bleeds the dormant
// base into the weak rounds. Imports are one-shot; skippers have a 14-day
// cooldown. The `source` column lets us read skipper vs import lift separately.
// Run ONE campaign per day for ~100/day total (or split the limit across both).
const DAILY_LIMIT = 100;
const CAMPAIGNS: Record<string, {
  outlet: string; round_start: number; round_end: number;
  name: string; offer_label: string; message: string; min_order: number; limit: number;
}> = {
  "conezion-breakfast": {
    outlet: "conezion", round_start: 7, round_end: 9, min_order: 35, limit: DAILY_LIMIT,
    name: "Conezion · Breakfast", offer_label: "Free coffee when you spend RM35+ (7–9am)",
    message: "Free coffee with breakfast at Celsius Conezion, 7-9am this week. Spend RM35+ and your coffee's on us. Show your number to redeem.",
  },
  "shah-alam-evening": {
    outlet: "shah-alam", round_start: 17, round_end: 19, min_order: 40, limit: DAILY_LIMIT,
    name: "Shah Alam · Evening", offer_label: "Free coffee when you spend RM40+ (5–7pm)",
    message: "Free coffee at Celsius Shah Alam, 5-7pm this week. Spend RM40+ and your coffee's on us. Show your number to redeem.",
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
      p_min_order: cfg.min_order,
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
      promo_id: row.promo_id,
      member_tag: row.member_tag,
      message: `Prepared ${cfg.name}: ${row.treated} treated + ${row.holdout} holdout. Review the round below, then Send to fire the SMS.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to prepare round-gap";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
