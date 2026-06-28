import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runClockInNudges } from "@/lib/ops-nudges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-clockin — no-clock-in nudge.
 *
 * For each staff with a published shift today whose start + grace has passed and
 * no clock-in: DMs the staff member ("please clock in") and adds them to a digest
 * for the manager (ops leads). Runs ONCE daily (~8:30am MYT) — catches the main
 * morning shift while it's still actionable, and keeps cost low (one run, not 48).
 * The ledger still dedupes per (staff, day). OPS_NUDGES_MODE (off|shadow|armed),
 * default armed. Design: docs/design/ops-performance-loop.md.
 */
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
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
