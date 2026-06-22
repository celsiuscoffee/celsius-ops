import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { sendDueRounds, autoMeasureDueRounds } from "@/lib/loyalty/loop-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/loops-send — fires any scheduled loop round whose send time has
// arrived, then measures any sent round whose attribution window has closed.
// Runs every ~15 min (vercel.json), so the scorecard updates within minutes of a
// window closing instead of waiting for the daily trigger cron. Approve-gated:
// only sends rounds an operator scheduled via /api/loyalty/loops/schedule.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    const sent = await sendDueRounds();
    const measured = await autoMeasureDueRounds();
    return NextResponse.json({ ...sent, measured: measured.measured });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops-send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
