import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runTriggeredLoops, autoMeasureDueRounds } from "@/lib/loyalty/loop-engine";

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
    const triggered = await runTriggeredLoops();
    const measured = await autoMeasureDueRounds();
    return NextResponse.json({ triggered, measured: measured.measured });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops-trigger failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
