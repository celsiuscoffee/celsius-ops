import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSession } from "@/lib/auth";
import { runReceivingRequests } from "@/lib/inventory/agents/receiving-requester";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/request-receivings — the GRN chaser. Reminds staff to receive POs
// that should have arrived but have no Receiving yet (gated + allow-listed,
// de-duped per PO). Scheduled in vercel.json.
//
// Auth: the Vercel cron secret (checkCronAuth), or an authenticated OWNER/ADMIN
// (so it can be run on demand for testing without the secret).
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getSession();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
    }
  }
  try {
    const result = await runReceivingRequests();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "request-receivings failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
