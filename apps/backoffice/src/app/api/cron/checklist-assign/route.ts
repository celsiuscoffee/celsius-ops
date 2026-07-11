import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { assignTodaysChecklists } from "@/lib/ops-nudges";
import { notifyResolvedReports } from "@/lib/ops-intake";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/checklist-assign — the 30-min ops housekeeping tick
 * (dispatcher pattern: the vercel.json cron budget is capped, so small
 * same-cadence duties share one slot).
 *
 * 1. Shift-start fair PRE-assignment: every still-unowned checklist for TODAY
 *    gets a fair owner from the published roster (station match + lightest
 *    load — same rules as the JIT nudge pass), so the app shows ownership all
 *    day instead of only after a task is overdue. Clock-in remains the truth
 *    at nudge time: the JIT pass re-owns to whoever actually clocked in.
 *    Unassigned checklists completed at 0% (0/279) vs 56% for assigned.
 *    OPS_NUDGES_MODE (off|shadow|armed, default armed).
 * 2. System-report resolution notify: WhatsApps reporters whose bug reports
 *    were RESOLVED from Claude Code (dev sessions can't send WhatsApp — the
 *    secrets live in Vercel). Free text in-window, ops template when cold.
 *
 * Runs every 30 min, 08:00–23:30 MYT; both duties are no-ops when idle.
 * Design: docs/design/verifier-agent.md.
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    const result = await assignTodaysChecklists();
    console.log(
      `[cron/checklist-assign] mode=${result.mode} scanned=${result.scanned} assigned=${result.assigned}`,
    );
    const notify = await notifyResolvedReports().catch((e) => {
      console.error("[cron/checklist-assign] resolution notify failed:", e);
      return { notified: 0, failed: 0 };
    });
    return NextResponse.json({ ok: true, ...result, reportsNotified: notify.notified });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "checklist-assign failed";
    console.error("[cron/checklist-assign]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
