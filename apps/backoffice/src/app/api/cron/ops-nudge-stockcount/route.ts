import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runStockCountNudges } from "@/lib/ops-nudges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ops-nudge-stockcount — no-stock-count nudge.
 *
 * For each active outlet with no SUBMITTED/REVIEWED count in the last 3 days
 * (OPS_NUDGE_STOCK_DAYS): DMs the on-shift team ("count + submit today") and adds
 * a line to the manager (ops leads) digest. Daily; the ledger dedupes per outlet
 * per day. OPS_NUDGES_MODE (off|shadow|armed), default shadow.
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
