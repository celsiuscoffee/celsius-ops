// Nightly finance close — runs at 4 AM MYT for yesterday. Chains the whole loop:
//   1. EOD ingest  → AR journals + channel invoices (routed StoreHub vs internal)
//   2. Matcher     → reconcile bank lines over a trailing window
//   3. Anomaly     → surface integrity problems over the same window
//
// Each step is idempotent, so re-running the date is safe. See runNightlyClose.

import { NextRequest, NextResponse } from "next/server";
import { runNightlyClose } from "@/lib/finance/orchestrator";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function yesterdayMyt(): string {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  myt.setUTCDate(myt.getUTCDate() - 1);
  return myt.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const result = await runNightlyClose(yesterdayMyt());
  return NextResponse.json(result);
}
