import { NextResponse } from "next/server";
import { runDailyPulse } from "@/lib/ops-pulse";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-pulse-daily — the once-a-day Ops Pulse digest.
 *
 * Sends each discipline lead one morning roundup of everything outstanding in
 * their lane (the habit-builder). No ledger, no escalation — just a predictable
 * daily message. Controlled by OPS_PULSE_DAILY_MODE (off | shadow | armed),
 * independent of the real-time OPS_PULSE_MODE. Scheduled ~9am MYT (vercel.json).
 *
 * Design: docs/design/ops-kpi-pulse-loop.md.
 */
async function runOpsPulseDaily() {
  try {
    const result = await runDailyPulse();
    console.log(`[cron/ops-pulse-daily] mode=${result.mode} items=${result.breachCount} sent=${result.sent}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-pulse-daily failed";
    console.error("[cron/ops-pulse-daily]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-pulse-daily", runOpsPulseDaily);
