import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runInvoiceRequests } from "@/lib/inventory/agents/invoice-requester";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/request-invoices — the agent's proactive invoice chaser. Asks the
// supplier for an invoice on every confirmed/in-delivery PO that has none yet
// (gated + allow-listed; de-duped per PO). Scheduled in vercel.json.
//
// Auth: the Vercel cron secret (via cronRoute). As a convenience for testing, an
// authenticated OWNER/ADMIN may also trigger it by hitting the URL while logged
// in (so you can run it on demand without the secret).
async function runRequestInvoices() {
  try {
    const result = await runInvoiceRequests();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request-invoices failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Heartbeat tier: a silent no-run stops invoice chasing, so POs pile up with
// no invoice and AP matching (and the books) quietly starve.
const cronGET = cronRoute("request-invoices", runRequestInvoices, {
  schedule: "0 */4 * * *",
  maxRuntime: 5, // maxDuration 120s + margin
});

// Preserved extra auth: an OWNER/ADMIN may trigger on demand without the cron
// secret (cronRoute would reject them), so check the session first and only
// then defer to the wrapped cron route.
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (user && ["OWNER", "ADMIN"].includes(user.role)) return runRequestInvoices();
  return cronGET(req);
}
