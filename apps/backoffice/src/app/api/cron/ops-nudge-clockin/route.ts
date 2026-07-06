import { NextResponse } from "next/server";
import { runClockInNudges } from "@/lib/ops-nudges";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-clockin — no-clock-in nudge.
 *
 * For each staff with a published shift today whose start + 15-min grace has
 * passed and no clock-in: DMs the staff member ("please clock in") and adds them
 * to a digest for the manager (ops leads). Trigger is per-shift: each shift trips
 * at its OWN rostered start + grace (morning, midday, afternoon, evening). Runs
 * every 5 min so the nudge lands right at the 15-min grace mark, not up to a poll
 * later. Cost is unchanged: the ledger dedupes per (staff, day), so each no-show
 * is DM'd once no matter how often the cron runs. OPS_NUDGES_MODE
 * (off|shadow|armed), default armed.
 * Design: docs/design/ops-performance-loop.md.
 */
async function runOpsNudgeClockin() {
  try {
    const result = await runClockInNudges();
    console.log(`[cron/ops-nudge-clockin] mode=${result.mode} items=${result.items} staff=${result.staffSent} mgr=${result.managerSent}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-nudge-clockin failed";
    console.error("[cron/ops-nudge-clockin]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-nudge-clockin", runOpsNudgeClockin);
