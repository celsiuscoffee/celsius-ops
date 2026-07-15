import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSession } from "@/lib/auth";
import { runProcurementExec } from "@/lib/inventory/exec/exec-controller";
import { runAndNotify as runPurchasingManager } from "@/lib/procurement/purchasing-manager";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

// GET /api/cron/procurement-exec — the daily procurement dispatcher. Runs two
// independent loops (both best-effort, one failing never blocks the other):
//   1. Procurement Exec accountability: unsent re-source orders + POs overdue
//      for receiving, brief to PROCUREMENT_EXEC_NOTIFY_TO.
//   2. Purchasing Manager agent: over-buying / duplicate-invoice / price-change
//      / short-delivery flags, logged to fin_agent_decisions, digest to the
//      owner. Folded in here rather than its own cron to stay within Vercel's
//      40-cron cap (see vercel-crons.test.ts).
//
// Auth: the Vercel cron secret, or an authenticated OWNER/ADMIN (run on demand for
// testing without the secret).
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getSession();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
    }
  }
  const exec = await runProcurementExec().catch((err) => ({ error: err instanceof Error ? err.message : "procurement-exec failed" }));
  const purchasingManager = await runPurchasingManager().catch((err) => ({ error: err instanceof Error ? err.message : "purchasing-manager failed" }));
  return NextResponse.json({ ok: true, exec, purchasingManager });
}
