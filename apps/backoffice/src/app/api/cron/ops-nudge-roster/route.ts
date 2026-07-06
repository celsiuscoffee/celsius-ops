import { NextResponse } from "next/server";
import { runRosterPublishNudges } from "@/lib/ops-nudges";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-roster — unpublished-roster guardrail.
 *
 * Every active outlet must have a PUBLISHED schedule covering the current week:
 * without one, staff can't be assigned checklists, the lateness nudge has
 * nothing to measure against, and the on-shift team resolves empty. This pages
 * the managers (ops leads) for any outlet missing one, distinguishing "built
 * but not published" (one click) from "no roster created" (real work). Born
 * from the Shah Alam week of 2026-06-29: a built roster whose publish never
 * landed ran silent for 5 days and cost ~43% of that week's checklist misses.
 * Daily 09:30 MYT; the ledger dedupes per (outlet, week) so one gap pings once.
 * OPS_NUDGES_MODE (off|shadow|armed), default armed.
 * Design: docs/design/ops-performance-loop.md.
 */
async function runOpsNudgeRoster() {
  try {
    const result = await runRosterPublishNudges();
    console.log(`[cron/ops-nudge-roster] mode=${result.mode} items=${result.items} mgr=${result.managerSent}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-nudge-roster failed";
    console.error("[cron/ops-nudge-roster]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-nudge-roster", runOpsNudgeRoster);
