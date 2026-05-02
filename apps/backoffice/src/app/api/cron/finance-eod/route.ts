// Daily cron — runs at 4 AM MYT to ingest yesterday's StoreHub EOD across
// all outlets and post AR journals via the AR agent.
//
// Idempotent: re-running for a date that's already been posted skips the
// outlet (see ingestOutletEod's existing-txn guard).

import { NextRequest, NextResponse } from "next/server";
import { ingestAllOutletsEod } from "@/lib/finance/ingestors/storehub-eod";
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

  const date = yesterdayMyt();
  const results = await ingestAllOutletsEod(date);

  const summary = {
    date,
    outlets: results.length,
    posted: results.filter((r) => r.posted).length,
    skipped: results.filter((r) => r.skipped).length,
    errors: results.filter((r) => r.error).length,
    totalAmount: results.reduce((s, r) => s + (r.posted?.amount ?? 0), 0),
  };

  return NextResponse.json({ summary, results });
}
