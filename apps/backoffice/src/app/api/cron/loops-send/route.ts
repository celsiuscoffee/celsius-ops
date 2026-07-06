import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron-monitor";
import { sendDueRounds, autoMeasureDueRounds } from "@/lib/loyalty/loop-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/loops-send — fires any scheduled loop round whose send time has
// arrived, then measures any sent round whose attribution window has closed.
// Runs every ~15 min (vercel.json), so the scorecard updates within minutes of a
// window closing instead of waiting for the daily trigger cron. Approve-gated:
// only sends rounds an operator scheduled via /api/loyalty/loops/schedule.
async function runLoopsSend() {
  try {
    const sent = await sendDueRounds();
    const measured = await autoMeasureDueRounds();
    return NextResponse.json({ ...sent, measured: measured.measured });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops-send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("loops-send", runLoopsSend);
