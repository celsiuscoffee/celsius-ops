import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runTriggeredLoops, autoMeasureDueRounds, runRoundGapDaily, autoPauseUnderperformers } from "@/lib/loyalty/loop-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/loops-trigger — daily. Fires the auto-triggered lifecycle loops
// (birthday today / ~1 day after 1st visit / just-lapsed) by auto-issuing the
// voucher + sending the SMS to each newly-qualifying member. Also auto-measures
// any sent round whose attribution window has closed so the leaderboard learns
// without a manual click. No budget cap; cooldowns prevent double-targeting.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    // Order matters: measure closed windows first, then let the kill rule read
    // the freshest verdicts, so a loop/arm that just proved dead doesn't get
    // one more day of sends.
    const measured = await autoMeasureDueRounds();
    const autoPaused = await autoPauseUnderperformers();
    const triggered = await runTriggeredLoops();
    const roundGap = await runRoundGapDaily(); // per-segment promo loop (its own mechanic)
    return NextResponse.json({ triggered, roundGap, measured: measured.measured, autoPaused });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops-trigger failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
