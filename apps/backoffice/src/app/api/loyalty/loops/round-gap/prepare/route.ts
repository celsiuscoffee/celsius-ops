import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { ROUND_GAP_CAMPAIGNS } from "@/lib/loyalty/loop-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/loyalty/loops/round-gap/prepare  { campaign: "conezion-breakfast" }
// Manual prepare for a single round-gap campaign (segment + per-arm tag +
// per-arm auto-promo). Does NOT send — kept for ad-hoc/catch-up use. Round-gap
// normally runs itself daily via the cron (runRoundGapDaily); the campaign
// config (audience, per-segment offers, copy) is the shared ROUND_GAP_CAMPAIGNS.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const body = await request.json().catch(() => ({}));
    const cfg = ROUND_GAP_CAMPAIGNS[body?.campaign as string];
    if (!cfg) {
      return NextResponse.json({ error: `Unknown campaign. Options: ${Object.keys(ROUND_GAP_CAMPAIGNS).join(", ")}` }, { status: 400 });
    }
    const { data, error } = await supabaseAdmin.rpc("loyalty_round_gap_prepare", {
      p_outlet: cfg.outlet,
      p_round_start: cfg.round_start,
      p_round_end: cfg.round_end,
      p_round_name: cfg.name,
      p_arms: cfg.arms,
      p_limit: cfg.daily_limit,
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
      message: `Prepared ${cfg.name}: ${row.treated} treated + ${row.holdout} holdout.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to prepare round-gap";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
