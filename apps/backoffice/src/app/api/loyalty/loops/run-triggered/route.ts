import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runTriggeredLoops, autoMeasureDueRounds } from "@/lib/loyalty/loop-engine";

// POST /api/loyalty/loops/run-triggered — manually fire all auto-triggered
// loops NOW (same work the daily cron does), for an on-demand first run or
// catch-up. Admin-gated; sends LIVE SMS to everyone who currently qualifies.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const triggered = await runTriggeredLoops();
    const measured = await autoMeasureDueRounds();
    return NextResponse.json({ triggered, measured: measured.measured });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to run triggered loops";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
