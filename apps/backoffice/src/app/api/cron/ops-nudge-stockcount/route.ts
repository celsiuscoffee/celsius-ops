import { NextResponse } from "next/server";
import { runStockCountNudges } from "@/lib/ops-nudges";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-stockcount — no-stock-count nudge.
 *
 * Follows the owner's Stock Count schedule (Settings → Stock Count). On a
 * scheduled count day (chosen weekday = regular count, month-end date = full
 * count) it DMs each outlet's on-shift team + a manager digest, for outlets that
 * haven't logged a count that day. Silent on non-count days. Runs daily (the
 * schedule gates whether it sends). OPS_NUDGES_MODE (off|shadow|armed), default armed.
 * Design: docs/design/ops-performance-loop.md.
 */
async function runOpsNudgeStockcount() {
  try {
    const result = await runStockCountNudges();
    console.log(`[cron/ops-nudge-stockcount] mode=${result.mode} items=${result.items} staff=${result.staffSent} mgr=${result.managerSent}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-nudge-stockcount failed";
    console.error("[cron/ops-nudge-stockcount]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-nudge-stockcount", runOpsNudgeStockcount);
