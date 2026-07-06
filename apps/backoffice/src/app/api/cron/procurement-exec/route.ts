import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runProcurementExec } from "@/lib/inventory/exec/exec-controller";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/procurement-exec — the Procurement Exec accountability loop (Inc 1).
// Catches re-source orders left unsent + POs overdue for receiving, and sends one
// brief/day to PROCUREMENT_EXEC_NOTIFY_TO. Gated + de-duped. Scheduled in vercel.json.
//
// Auth: the Vercel cron secret, or an authenticated OWNER/ADMIN (run on demand for
// testing without the secret).
async function runProcurementExecCron() {
  try {
    const result = await runProcurementExec();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "procurement-exec failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Heartbeat tier: a silent no-run means unsent re-source orders and overdue
// POs go unchased — stockouts and supplier money slip by unnoticed.
const cronGET = cronRoute("procurement-exec", runProcurementExecCron, {
  schedule: "0 1 * * *",
  maxRuntime: 5, // maxDuration 120s + margin
});

// Preserved extra auth: an OWNER/ADMIN may trigger on demand without the cron
// secret (cronRoute would reject them), so check the session first and only
// then defer to the wrapped cron route.
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (user && ["OWNER", "ADMIN"].includes(user.role)) return runProcurementExecCron();
  return cronGET(req);
}
