import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runChecklistNudges } from "@/lib/ops-nudges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-checklist — checklist-not-done nudge to the INDIVIDUAL owner.
 *
 * Owner resolved by role + clock-in: the present person rostered to the matching
 * role (OPENING/CLOSING) at the outlet today owns it (an explicit assignedToId wins
 * if that person clocked in). No one in that role on shift → the shift lead; no lead
 * → a managers digest. Roster is the plan, CLOCK-IN is the truth — an absent person
 * is never blamed for a task they weren't there for. Same-day, recently overdue
 * (grace–3h) so the owner is still on shift and can act. Deduped per checklist.
 * Runs every 15 min. OPS_NUDGES_MODE (off|shadow|armed, default armed).
 * Design: docs/design/checklist-individual-accountability.md.
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    const result = await runChecklistNudges();
    console.log(
      `[cron/ops-nudge-checklist] mode=${result.mode} items=${result.items} staff=${result.staffSent} mgr=${result.managerSent}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-nudge-checklist failed";
    console.error("[cron/ops-nudge-checklist]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
