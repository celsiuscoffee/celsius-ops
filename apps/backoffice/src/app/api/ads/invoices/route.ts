import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Malaysia Service Tax on digital services (including Google Ads) — 8% since Mar 2024.
const SST_RATE = 0.08;

// Generate per-campaign monthly statements from synced metrics.
// This replaces pulling actual Google invoices (not available for card-billed
// accounts). Output is suitable for LHDN audit support: shows campaign-level
// spend + SST per month, with account totals and grand total.
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") ?? new Date().getUTCFullYear());

  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  // Campaign-level metrics only (campaignId not null)
  const rows = await prisma.adsMetricDaily.findMany({
    where: { date: { gte: from, lt: to }, campaignId: { not: null } },
    select: { date: true, costMicros: true, campaignId: true, accountId: true },
  });

  // Also fetch campaigns + outlets for display names
  const campaignIds = Array.from(new Set(rows.map((r) => r.campaignId!).filter(Boolean)));
  const campaigns = await prisma.adsCampaign.findMany({
    where: { id: { in: campaignIds } },
    select: { id: true, name: true, outletId: true },
  });
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  const outletIds = Array.from(new Set(campaigns.map((c) => c.outletId).filter((x): x is string => !!x)));
  const outlets = outletIds.length
    ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
    : [];
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  // Bucket: { "YYYY-MM": { [campaignId]: costMicros } }
  const buckets = new Map<string, Map<string, bigint>>();
  for (const r of rows) {
    const ym = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!buckets.has(ym)) buckets.set(ym, new Map());
    const month = buckets.get(ym)!;
    const key = r.campaignId!;
    month.set(key, (month.get(key) ?? BigInt(0)) + r.costMicros);
  }

  // Build structured output sorted by month desc
  const statements = Array.from(buckets.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([yearMonth, monthRows]) => {
      const items = Array.from(monthRows.entries())
        .map(([cid, cost]) => {
          const c = campaignMap.get(cid);
          const subtotal = Number(cost) / 1_000_000;
          const tax = subtotal * SST_RATE;
          return {
            campaignId: cid,
            campaignName: c?.name ?? "Unknown",
            outletId: c?.outletId ?? null,
            outletName: c?.outletId ? outletMap.get(c.outletId) ?? null : null,
            subtotalMYR: subtotal,
            taxMYR: tax,
            totalMYR: subtotal + tax,
          };
        })
        .sort((a, b) => b.subtotalMYR - a.subtotalMYR);

      const subtotal = items.reduce((s, i) => s + i.subtotalMYR, 0);
      const tax = items.reduce((s, i) => s + i.taxMYR, 0);

      return {
        yearMonth,
        items,
        subtotalMYR: subtotal,
        taxMYR: tax,
        totalMYR: subtotal + tax,
      };
    });

  const ytdSubtotal = statements.reduce((s, m) => s + m.subtotalMYR, 0);
  const ytdTax = statements.reduce((s, m) => s + m.taxMYR, 0);

  return NextResponse.json({
    year,
    sstRate: SST_RATE,
    statements,
    summary: {
      subtotalMYR: ytdSubtotal,
      taxMYR: ytdTax,
      totalMYR: ytdSubtotal + ytdTax,
      monthCount: statements.length,
    },
  });
}
