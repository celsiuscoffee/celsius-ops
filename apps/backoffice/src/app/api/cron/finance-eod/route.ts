// Daily cron — runs at 4 AM MYT to ingest yesterday's EOD across all outlets
// and post AR journals via the AR agent. Each outlet is routed by ingestEodForDate
// to the POS that owned it that day: POS-native on/after its cutover, StoreHub
// before (historical). Once every outlet has cut over this is fully native.
//
// Idempotent: re-running for a date that's already been posted skips the
// outlet (shared outlet+date guard in the ingestors).

import { NextRequest, NextResponse } from "next/server";
import { ingestEodForDate } from "@/lib/finance/ingestors/pos-native-eod";
import { checkCronAuth } from "@celsius/shared";
import { touchAgentRun, logAgentAction } from "@/lib/agents/substrate";

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

  await touchAgentRun("finance_eod");
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

  await logAgentAction({
    agentKey: "finance_eod",
    kind: "eod_posted",
    summary: `Posted EOD AR for ${summary.date}: ${summary.posted}/${summary.outlets} outlets, RM${summary.totalAmount.toFixed(2)}${summary.errors ? `, ${summary.errors} errors` : ""}`,
    meta: summary,
  });

  return NextResponse.json({ summary, results });
}
