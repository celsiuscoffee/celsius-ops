import { NextResponse } from "next/server";
import { runStoreStatusNudges } from "@/lib/ops-nudges";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-store — store-status nudge.
 *
 * Brings the two previously-dark ops-pulse signals live on the dedicated-nudge
 * tier (without arming the whole legacy pulse, which would race the specialized
 * clock-in/checklist routing through the shared ledger):
 *   • POS not opened — an active outlet past its open time with no till session
 *     (HIGH: the outlet isn't trading, straight lost revenue).
 *   • Menu 86'd — items snoozed off the menu (MED: lost attach + a stale menu).
 * Sends the outlet's on-shift team + a digest to the managers (ops leads). The
 * ledger dedupes per (outlet, day), so each fires at most once a day no matter
 * how often the cron runs. Every 15 min so a late open is caught soon after the
 * open time. OPS_NUDGES_MODE (off|shadow|armed), default armed.
 * Design: docs/design/ops-performance-loop.md.
 */
async function runOpsNudgeStore() {
  try {
    const result = await runStoreStatusNudges();
    console.log(`[cron/ops-nudge-store] mode=${result.mode} items=${result.items} staff=${result.staffSent} mgr=${result.managerSent}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-nudge-store failed";
    console.error("[cron/ops-nudge-store]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-nudge-store", runOpsNudgeStore);
