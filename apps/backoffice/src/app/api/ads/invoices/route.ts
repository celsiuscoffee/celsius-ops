import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SST_RATE = 0.08;

// Generate per-outlet, per-month ad-spend statements with SST.
// Each outlet's spend in a month is a separate claim (INITIATED until
// the person who fronted the money is reimbursed).
//
// Shape:
//   statements[]: { yearMonth, outlets[]: { outletId, outletName, campaigns[], payment?, ... } }
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year") ?? new Date().getUTCFullYear());
  const outletFilter = url.searchParams.get("outletId");
  const campaignFilter = url.searchParams.get("campaignId");

  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  // Campaign filter narrows set
  let campaignIdFilter: string[] | undefined;
  if (campaignFilter && campaignFilter !== "all") {
    campaignIdFilter = [campaignFilter];
  } else if (outletFilter && outletFilter !== "all") {
    const where = outletFilter === "unlinked" ? { outletId: null } : { outletId: outletFilter };
    const campaigns = await prisma.adsCampaign.findMany({ where, select: { id: true } });
    campaignIdFilter = campaigns.map((c) => c.id);
    if (campaignIdFilter.length === 0) {
      return NextResponse.json({
        year, sstRate: SST_RATE, statements: [],
        summary: { subtotalMYR: 0, taxMYR: 0, totalMYR: 0, monthCount: 0, claimedMYR: 0, paidMYR: 0, outstandingMYR: 0 },
      });
    }
  }

  const rows = await prisma.adsMetricDaily.findMany({
    where: {
      date: { gte: from, lt: to },
      campaignId: campaignIdFilter ? { in: campaignIdFilter } : { not: null },
    },
    select: { date: true, costMicros: true, campaignId: true },
  });

  const allCampaignIds = Array.from(new Set(rows.map((r) => r.campaignId!).filter(Boolean)));
  const campaigns = await prisma.adsCampaign.findMany({
    where: { id: { in: allCampaignIds } },
    select: { id: true, name: true, outletId: true },
  });
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));

  const outletIds = Array.from(new Set(campaigns.map((c) => c.outletId).filter((x): x is string => !!x)));
  const outlets = outletIds.length
    ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
    : [];
  const outletNameMap = new Map(outlets.map((o) => [o.id, o.name]));

  // Bucket: { yearMonth: { outletKey: { outletId, outletName, byCampaign: Map<campaignId, micros> } } }
  type OutletBucket = {
    outletId: string | null;
    outletName: string;
    byCampaign: Map<string, bigint>;
  };
  const monthBuckets = new Map<string, Map<string, OutletBucket>>();

  for (const r of rows) {
    if (!r.campaignId) continue;
    const c = campaignMap.get(r.campaignId);
    if (!c) continue;
    const ym = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const outletKey = c.outletId ?? "__unlinked__";
    if (!monthBuckets.has(ym)) monthBuckets.set(ym, new Map());
    const month = monthBuckets.get(ym)!;
    if (!month.has(outletKey)) {
      month.set(outletKey, {
        outletId: c.outletId,
        outletName: c.outletId ? (outletNameMap.get(c.outletId) ?? "Unknown outlet") : "Unlinked",
        byCampaign: new Map(),
      });
    }
    const bucket = month.get(outletKey)!;
    bucket.byCampaign.set(r.campaignId, (bucket.byCampaign.get(r.campaignId) ?? BigInt(0)) + r.costMicros);
  }

  // Load payments for the year
  const payments = await prisma.adsPayment.findMany({
    where: { yearMonth: { startsWith: `${year}-` } },
  });
  const paymentMap = new Map<string, typeof payments[number]>();
  for (const p of payments) {
    const key = `${p.yearMonth}|${p.outletId ?? "__unlinked__"}|${p.campaignId ?? ""}`;
    paymentMap.set(key, p);
  }

  const statements = Array.from(monthBuckets.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([yearMonth, outletMap]) => {
      const outletRows = Array.from(outletMap.values())
        .map((b) => {
          const campaignItems = Array.from(b.byCampaign.entries())
            .map(([cid, cost]) => {
              const c = campaignMap.get(cid);
              const subtotal = Number(cost) / 1_000_000;
              const tax = subtotal * SST_RATE;
              return {
                campaignId: cid,
                campaignName: c?.name ?? "Unknown",
                subtotalMYR: subtotal,
                taxMYR: tax,
                totalMYR: subtotal + tax,
              };
            })
            .sort((a, b) => b.subtotalMYR - a.subtotalMYR);
          const subtotal = campaignItems.reduce((s, i) => s + i.subtotalMYR, 0);
          const tax = campaignItems.reduce((s, i) => s + i.taxMYR, 0);

          const paymentKey = `${yearMonth}|${b.outletId ?? "__unlinked__"}|`;
          const p = paymentMap.get(paymentKey);

          return {
            outletId: b.outletId,
            outletName: b.outletName,
            campaigns: campaignItems,
            subtotalMYR: subtotal,
            taxMYR: tax,
            totalMYR: subtotal + tax,
            payment: p ? {
              id: p.id,
              status: p.status,
              paidAt: p.paidAt?.toISOString() ?? null,
              paymentMethod: p.paymentMethod,
              referenceNumber: p.referenceNumber,
              popPhotos: p.popPhotos,
              notes: p.notes,
            } : null,
          };
        })
        .sort((a, b) => b.subtotalMYR - a.subtotalMYR);

      const subtotal = outletRows.reduce((s, o) => s + o.subtotalMYR, 0);
      const tax = outletRows.reduce((s, o) => s + o.taxMYR, 0);
      return { yearMonth, outlets: outletRows, subtotalMYR: subtotal, taxMYR: tax, totalMYR: subtotal + tax };
    });

  // Summary — total, paid (PAID+VERIFIED), outstanding (INITIATED or no record)
  let totalAll = 0, paid = 0, claimed = 0, outstanding = 0;
  for (const m of statements) {
    totalAll += m.totalMYR;
    for (const o of m.outlets) {
      if (o.payment?.status === "PAID" || o.payment?.status === "VERIFIED") paid += o.totalMYR;
      else if (o.payment?.status === "INITIATED") claimed += o.totalMYR;
      else outstanding += o.totalMYR;
    }
  }
  const ytdSubtotal = statements.reduce((s, m) => s + m.subtotalMYR, 0);
  const ytdTax = statements.reduce((s, m) => s + m.taxMYR, 0);

  return NextResponse.json({
    year,
    sstRate: SST_RATE,
    statements,
    summary: {
      subtotalMYR: ytdSubtotal,
      taxMYR: ytdTax,
      totalMYR: totalAll,
      monthCount: statements.length,
      claimedMYR: claimed,
      paidMYR: paid,
      outstandingMYR: outstanding,
    },
  });
}
