// On-demand trigger for the Purchasing Manager agent (OWNER/ADMIN, or the cron
// secret). NOT scheduled in vercel.json — the daily run is folded into the
// procurement-exec dispatcher to stay within Vercel's 40-cron cap. This route
// exists so the agent can be run on demand for testing or an ad-hoc sweep.
//
// Advisory only: detects and flags (over-buying, duplicate invoices, price
// changes, short deliveries), logs to fin_agent_decisions, digests to Telegram.

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getSession } from "@/lib/auth";
import { runAndNotify } from "@/lib/procurement/purchasing-manager";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getSession();
    if (!user || !["OWNER", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
    }
  }
  try {
    return NextResponse.json(await runAndNotify());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
