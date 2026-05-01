import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncInvoices } from "@/lib/ads/sync-invoices";
import { runSync } from "@/lib/ads/run-sync";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Runs on the 2nd of each month @ 4 AM MYT via Vercel Cron.
// Pulls the previous month's invoices for every active account.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const settings = await prisma.adsSettings.findUnique({ where: { id: "singleton" } });
  if (settings && !settings.invoiceSyncEnabled) {
    return NextResponse.json({ skipped: true, reason: "invoice_sync_disabled" });
  }

  // Previous month
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const ym = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

  const accounts = await prisma.adsAccount.findMany({
    where: { isManager: false, status: "ENABLED" },
  });

  const results: Array<Record<string, unknown>> = [];
  for (const acc of accounts) {
    const run = await runSync("invoices", acc.id, async () => {
      const { rows } = await syncInvoices(acc.id, acc.customerId, ym, ym);
      return { rowsInserted: rows, metadata: { yearMonth: ym } };
    });
    results.push({ customerId: acc.customerId, result: run.error ?? run.result });
  }

  return NextResponse.json({ ok: true, yearMonth: ym, perAccount: results });
}
