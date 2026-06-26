import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSession } from "@/lib/auth";
import { runInvoiceRequests } from "@/lib/inventory/agents/invoice-requester";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/request-invoices — the agent's proactive invoice chaser. Asks the
// supplier for an invoice on every confirmed/in-delivery PO that has none yet
// (gated + allow-listed; de-duped per PO). Scheduled in vercel.json.
//
// Auth: the Vercel cron secret (checkCronAuth). As a convenience for testing, an
// authenticated OWNER/ADMIN may also trigger it by hitting the URL while logged
// in (so you can run it on demand without the secret).
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getSession();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
    }
  }
  try {
    const result = await runInvoiceRequests();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request-invoices failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
