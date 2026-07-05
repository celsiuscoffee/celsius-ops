// Daily cron — runs at 4 AM MYT to ingest yesterday's EOD across all outlets
// and post AR journals via the AR agent. Each outlet is routed by ingestEodForDate
// to the POS that owned it that day: POS-native on/after its cutover, StoreHub
// before (historical). Once every outlet has cut over this is fully native.
//
// Idempotent: re-running for a date that's already been posted skips the
// outlet (shared outlet+date guard in the ingestors).

import { NextResponse } from "next/server";
import { ingestEodForDate } from "@/lib/finance/ingestors/pos-native-eod";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function yesterdayMyt(): string {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  myt.setUTCDate(myt.getUTCDate() - 1);
  return myt.toISOString().slice(0, 10);
}

async function runFinanceEod() {
  const date = yesterdayMyt();
  const results = await ingestEodForDate(date);

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

// Heartbeat tier: EOD ingestion is the finance book of record — a
// silently skipped night must page, not wait to be noticed at month end.
export const GET = cronRoute("finance-eod", runFinanceEod, {
  schedule: "0 20 * * *",
  maxRuntime: 8, // maxDuration 300s + margin
});
