import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron-monitor";
import { assignTodaysChecklists } from "@/lib/ops-nudges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/checklist-assign — shift-start fair PRE-assignment.
 *
 * Assigns every still-unowned checklist for TODAY a fair owner from the
 * published roster (station match + lightest load — same rules as the JIT
 * nudge pass), so the app shows ownership all day instead of only after a
 * task is overdue. Clock-in remains the truth at nudge time: the JIT pass
 * re-owns to whoever actually clocked in. Unassigned checklists completed at
 * 0% (0/279) vs 56% for assigned — this closes that gap mechanically.
 * Runs every 30 min through the trading day; each run is a no-op when
 * everything is owned. OPS_NUDGES_MODE (off|shadow|armed, default armed).
 * Design: docs/design/verifier-agent.md.
 */
async function runChecklistAssign() {
  try {
    const result = await assignTodaysChecklists();
    console.log(
      `[cron/checklist-assign] mode=${result.mode} scanned=${result.scanned} assigned=${result.assigned}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "checklist-assign failed";
    console.error("[cron/checklist-assign]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("checklist-assign", runChecklistAssign);
