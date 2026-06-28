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
 * for the manager (ops leads). Runs every 15 min so each shift trips at its OWN
 * start time (morning, midday, afternoon, evening), not just the morning. Cost is
 * unchanged: the ledger dedupes per (staff, day), so each no-show is DM'd once no
 * matter how often the cron runs — frequency only sets how promptly lateness is
 * caught. OPS_NUDGES_MODE (off|shadow|armed), default armed.
 * Design: docs/design/ops-performance-loop.md.
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
