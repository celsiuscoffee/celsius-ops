import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSession } from "@/lib/auth";
import { runProcurementExec } from "@/lib/inventory/exec/exec-controller";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/procurement-exec — the Procurement Exec accountability loop (Inc 1).
// Catches re-source orders left unsent + POs overdue for receiving, and sends one
// brief/day to PROCUREMENT_EXEC_NOTIFY_TO. Gated + de-duped. Scheduled in vercel.json.
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
  try {
    const result = await runProcurementExec();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "procurement-exec failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
