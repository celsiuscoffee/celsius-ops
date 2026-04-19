import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const outletId = url.searchParams.get("outletId"); // "all" | "unlinked" | outletId
  const campaignId = url.searchParams.get("campaignId"); // "all" | campaignId
  const hasFilter = (outletId && outletId !== "all") || (campaignId && campaignId !== "all");

  // Resolve campaign set for filters. When nothing is filtered, we use
  // account-level rollup rows (campaignId: null). When filtered, we sum
  // per-campaign rows (campaignId: { in: ... }) so totals stay accurate.
  let campaignIdFilter: string[] | undefined;
  if (campaignId && campaignId !== "all") {
    campaignIdFilter = [campaignId];
  } else if (outletId && outletId !== "all") {
    const where = outletId === "unlinked" ? { outletId: null } : { outletId };
    const cs = await prisma.adsCampaign.findMany({ where, select: { id: true } });
    campaignIdFilter = cs.map((c) => c.id);
    if (campaignIdFilter.length === 0) {
      return NextResponse.json({
        mtd: { impressions: 0, clicks: 0, conversions: 0, costMYR: 0 },
        prev: { impressions: 0, clicks: 0, conversions: 0, costMYR: 0 },
        trend: [],
        topCampaigns: [],
      });
    }
  }

  const metricWhere = hasFilter
    ? { campaignId: { in: campaignIdFilter! } }
    : { campaignId: null };

  const today = new Date();
  const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const startPrevMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const endPrevMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const ninetyDaysAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 90));

  const monthRows = await prisma.adsMetricDaily.findMany({
    where: { date: { gte: startOfMonth }, ...metricWhere },
  });
  const prevMonthRows = await prisma.adsMetricDaily.findMany({
    where: { date: { gte: startPrevMonth, lte: endPrevMonth }, ...metricWhere },
  });
  const trendRows = await prisma.adsMetricDaily.findMany({
    where: { date: { gte: ninetyDaysAgo }, ...metricWhere },
    orderBy: { date: "asc" },
    select: { date: true, costMicros: true, clicks: true, impressions: true, conversions: true },
  });

  const sum = (rows: typeof monthRows) => rows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + Number(r.impressions),
      clicks: acc.clicks + Number(r.clicks),
      conversions: acc.conversions + Number(r.conversions),
      costMYR: acc.costMYR + Number(r.costMicros) / 1_000_000,
    }),
    { impressions: 0, clicks: 0, conversions: 0, costMYR: 0 },
  );

  const mtd = sum(monthRows);
  const prev = sum(prevMonthRows);

  // For trend, bucket by date when filtering (multiple campaign rows per date).
  const trendMap = new Map<string, { costMYR: number; clicks: number; impressions: number; conversions: number }>();
  for (const r of trendRows) {
    const d = r.date.toISOString().slice(0, 10);
    const curr = trendMap.get(d) ?? { costMYR: 0, clicks: 0, impressions: 0, conversions: 0 };
    curr.costMYR += Number(r.costMicros) / 1_000_000;
    curr.clicks += Number(r.clicks);
    curr.impressions += Number(r.impressions);
    curr.conversions += Number(r.conversions);
    trendMap.set(d, curr);
  }
  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  // Top 5 campaigns MTD by cost (respects campaign filter)
  const topCampaignsData = await prisma.adsMetricDaily.groupBy({
    by: ["campaignId"],
    where: {
      date: { gte: startOfMonth },
      campaignId: campaignIdFilter ? { in: campaignIdFilter } : { not: null },
    },
    _sum: { costMicros: true, clicks: true, conversions: true },
    orderBy: { _sum: { costMicros: "desc" } },
    take: 5,
  });
  const campaignIds = topCampaignsData.map((r) => r.campaignId!).filter(Boolean);
  const campaigns = await prisma.adsCampaign.findMany({ where: { id: { in: campaignIds } } });
  const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
  const topCampaigns = topCampaignsData.map((r) => ({
    id: r.campaignId!,
    name: campaignMap.get(r.campaignId!)?.name ?? "Unknown",
    costMYR: Number(r._sum.costMicros ?? 0) / 1_000_000,
    clicks: Number(r._sum.clicks ?? 0),
    conversions: Number(r._sum.conversions ?? 0),
  }));

  return NextResponse.json({ mtd, prev, trend, topCampaigns });
}
