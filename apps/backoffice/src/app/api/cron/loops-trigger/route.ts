import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron-monitor";
import { runTriggeredLoops, autoMeasureDueRounds, runRoundGapDaily } from "@/lib/loyalty/loop-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/loops-trigger — daily. Fires the auto-triggered lifecycle loops
// (birthday today / ~1 day after 1st visit / just-lapsed) by auto-issuing the
// voucher + sending the SMS to each newly-qualifying member. Also auto-measures
// any sent round whose attribution window has closed so the leaderboard learns
// without a manual click. No budget cap; cooldowns prevent double-targeting.
async function runLoopsTrigger() {
  try {
    const triggered = await runTriggeredLoops();
    const roundGap = await runRoundGapDaily(); // per-segment promo loop (its own mechanic)
    const measured = await autoMeasureDueRounds();
    return NextResponse.json({ triggered, roundGap, measured: measured.measured });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops-trigger failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("loops-trigger", runLoopsTrigger);
