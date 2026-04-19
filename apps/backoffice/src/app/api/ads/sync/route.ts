import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { runSync } from "@/lib/ads/run-sync";
import { syncAccounts } from "@/lib/ads/sync-accounts";
import { syncCampaigns } from "@/lib/ads/sync-campaigns";
import { syncMetrics } from "@/lib/ads/sync-metrics";
import { syncInvoices } from "@/lib/ads/sync-invoices";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Manual sync trigger from /ads/settings.
// Body: { kind: "accounts" | "all" | "metrics" | "invoices"; days?: number; yearMonth?: string }
export async function POST(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as { kind: string; days?: number; yearMonth?: string };
  const { kind, days = 7, yearMonth } = body;

  if (kind === "accounts") {
    const r = await runSync("accounts", null, async () => {
      const { inserted, updated } = await syncAccounts();
      return { rowsInserted: inserted, rowsUpdated: updated };
    });
    return NextResponse.json(r);
  }

  const accounts = await prisma.adsAccount.findMany({
    where: { isManager: false, status: "ACTIVE" },
  });

  if (accounts.length === 0) {
    return NextResponse.json({ error: "No active accounts — run 'accounts' sync first" }, { status: 400 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const acc of accounts) {
    if (kind === "all" || kind === "metrics") {
      const camp = await runSync("campaigns", acc.id, async () => {
        const { inserted, updated } = await syncCampaigns(acc.id, acc.customerId);
        return { rowsInserted: inserted, rowsUpdated: updated };
      });
      const to = new Date();
      const from = new Date();
      from.setUTCDate(from.getUTCDate() - days);
      const met = await runSync("metrics-backfill", acc.id, async () => {
        const { rows } = await syncMetrics(
          acc.id,
          acc.customerId,
          from.toISOString().slice(0, 10),
          to.toISOString().slice(0, 10),
        );
        return { rowsInserted: rows, metadata: { days } };
      });
      results.push({ account: acc.customerId, campaigns: camp.result, metrics: met.result, errors: [camp.error, met.error].filter(Boolean) });
    }

    if (kind === "all" || kind === "invoices") {
      const now = new Date();
      const defaultFrom = `${now.getUTCFullYear()}-01`;
      const defaultTo = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      const ym = yearMonth ?? defaultTo;
      const run = await runSync("invoices", acc.id, async () => {
        const { rows } = await syncInvoices(acc.id, acc.customerId, yearMonth ?? defaultFrom, ym);
        return { rowsInserted: rows, metadata: { from: yearMonth ?? defaultFrom, to: ym } };
      });
      results.push({ account: acc.customerId, invoices: run.result, error: run.error });
    }

    await prisma.adsAccount.update({
      where: { id: acc.id },
      data: { lastSyncedAt: new Date() },
    });
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logs = await prisma.adsSyncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 30,
  });
  return NextResponse.json({ logs });
}
