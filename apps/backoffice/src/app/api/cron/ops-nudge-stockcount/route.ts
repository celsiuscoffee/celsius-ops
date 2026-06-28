import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runStockCountNudges } from "@/lib/ops-nudges";

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
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
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
