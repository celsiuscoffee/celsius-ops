import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runTriggeredLoops, autoMeasureDueRounds, runRoundGapDaily } from "@/lib/loyalty/loop-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // sending hundreds of SMS sequentially needs headroom

// POST /api/loyalty/loops/run-triggered — manually fire all auto-triggered
// loops NOW (same work the daily cron does), for an on-demand first run or
// catch-up. Admin-gated; sends LIVE SMS to everyone who currently qualifies.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    // force:true bypasses the once-a-day guard (cooldown still applies).
    const body = await request.json().catch(() => ({}));
    const force = body?.force === true;
    const triggered = await runTriggeredLoops({ force });
    const roundGap = await runRoundGapDaily({ force });
    const measured = await autoMeasureDueRounds();
    return NextResponse.json({ triggered, roundGap, measured: measured.measured });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to run triggered loops";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
