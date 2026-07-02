import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncCampaigns } from "@/lib/ads/sync-campaigns";
import { syncMetrics } from "@/lib/ads/sync-metrics";
import { syncSearchTerms } from "@/lib/ads/sync-search-terms";
import { runSync } from "@/lib/ads/run-sync";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual backfill for ads metrics across an arbitrary date range.
// Use after a missed-cron incident or to bootstrap a new account.
//
// GET /api/cron/ads-backfill?from=2026-04-30&to=2026-05-01
//   Authorization: Bearer <CRON_SECRET>
//
// Refreshes campaigns once per account, then pulls metrics for [from, to]
// inclusive in a single GAQL query. Same logging path as the daily cron
// so the runs show up in ads_sync_log.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: "from and to required as YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
  }

  const accounts = await prisma.adsAccount.findMany({
    where: { isManager: false, status: "ENABLED" },
  });

  const results: Array<Record<string, unknown>> = [];
  for (const acc of accounts) {
    const camp = await runSync("campaigns", acc.id, async () => {
      const { inserted, updated } = await syncCampaigns(acc.id, acc.customerId);
      return { rowsInserted: inserted, rowsUpdated: updated };
    });
    const met = await runSync("metrics-backfill", acc.id, async () => {
      const { rows } = await syncMetrics(acc.id, acc.customerId, from, to);
      return { rowsInserted: rows, metadata: { from, to } };
    });
    const terms = await runSync("search-terms", acc.id, async () => {
      const { rows } = await syncSearchTerms(acc.id, acc.customerId, from, to);
      return { rowsInserted: rows, metadata: { from, to } };
    });

    await prisma.adsAccount.update({
      where: { id: acc.id },
      data: { lastSyncedAt: new Date() },
    });

    results.push({
      customerId: acc.customerId,
      campaigns: camp.error ?? camp.result,
      metrics: met.error ?? met.result,
      searchTerms: terms.error ?? terms.result,
    });
  }

  return NextResponse.json({ ok: true, from, to, perAccount: results });
}
