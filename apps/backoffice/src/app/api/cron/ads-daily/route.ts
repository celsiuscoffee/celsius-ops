import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncAccounts } from "@/lib/ads/sync-accounts";
import { syncCampaigns } from "@/lib/ads/sync-campaigns";
import { syncMetrics } from "@/lib/ads/sync-metrics";
import { runSync } from "@/lib/ads/run-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min

// Runs daily @ 3 AM MYT via Vercel Cron.
// - Refreshes account list
// - For each non-manager account: refreshes campaigns, then pulls yesterday's metrics.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.adsSettings.findUnique({ where: { id: "singleton" } });
  if (settings && !settings.dailySyncEnabled) {
    return NextResponse.json({ skipped: true, reason: "daily_sync_disabled" });
  }

  // Step 1: sync accounts
  const accountsRun = await runSync("accounts", null, async () => {
    const { inserted, updated } = await syncAccounts();
    return { rowsInserted: inserted, rowsUpdated: updated };
  });

  // Step 2 & 3 per non-manager account
  const accounts = await prisma.adsAccount.findMany({
    where: { isManager: false, status: "ACTIVE" },
  });

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const y = yesterday.toISOString().slice(0, 10);

  const results: Array<Record<string, unknown>> = [];
  for (const acc of accounts) {
    const camp = await runSync("campaigns", acc.id, async () => {
      const { inserted, updated } = await syncCampaigns(acc.id, acc.customerId);
      return { rowsInserted: inserted, rowsUpdated: updated };
    });
    const met = await runSync("metrics-daily", acc.id, async () => {
      const { rows } = await syncMetrics(acc.id, acc.customerId, y, y);
      return { rowsInserted: rows };
    });

    await prisma.adsAccount.update({
      where: { id: acc.id },
      data: { lastSyncedAt: new Date() },
    });

    results.push({
      customerId: acc.customerId,
      campaigns: camp.error ?? camp.result,
      metrics: met.error ?? met.result,
    });
  }

  return NextResponse.json({
    ok: true,
    date: y,
    accounts: accountsRun.error ?? accountsRun.result,
    perAccount: results,
  });
}
