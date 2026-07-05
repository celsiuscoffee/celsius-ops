import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runReceivingRequests } from "@/lib/inventory/agents/receiving-requester";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/request-receivings — the GRN chaser. Reminds staff to receive POs
// that should have arrived but have no Receiving yet (gated + allow-listed,
// de-duped per PO). Scheduled in vercel.json.
//
// Auth: the Vercel cron secret (via cronRoute), or an authenticated OWNER/ADMIN
// (so it can be run on demand for testing without the secret).
async function runRequestReceivings() {
  try {
    const result = await runReceivingRequests();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request-receivings failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Heartbeat tier: a silent no-run means overdue POs are never chased into a
// GRN, so stock and AP drift from what was actually delivered and paid.
const cronGET = cronRoute("request-receivings", runRequestReceivings, {
  schedule: "0 */6 * * *",
  maxRuntime: 5, // maxDuration 120s + margin
});

// Preserved extra auth: an OWNER/ADMIN may trigger on demand without the cron
// secret (cronRoute would reject them), so check the session first and only
// then defer to the wrapped cron route.
export async function GET(req: NextRequest) {
  const user = await getSession();
  if (user && ["OWNER", "ADMIN"].includes(user.role)) return runRequestReceivings();
  return cronGET(req);
}
