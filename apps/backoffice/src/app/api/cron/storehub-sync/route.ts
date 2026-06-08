// Daily cron — keeps the StoreHub sales archive (storehub_sales) fresh for outlets
// still on StoreHub, so the repointed sales dashboard (which reads the archive,
// not the live StoreHub API) stays current until every outlet has cut over to
// POS-native. Pulls the last 3 days (idempotent upsert), runs at 4:30 AM MYT —
// just after finance-eod (4 AM). Once all outlets are >7 days past cutover this
// becomes a no-op, and StoreHub can be cancelled.

import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { syncRecentStorehubSales } from "@/lib/storehub-archive";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const results = await syncRecentStorehubSales(3);
  const summary = {
    outlets: results.length,
    synced: results.reduce((s, r) => s + r.synced, 0),
    skipped: results.filter((r) => r.skipped).length,
    errors: results.filter((r) => r.error).length,
  };
  return NextResponse.json({ summary, results });
}
