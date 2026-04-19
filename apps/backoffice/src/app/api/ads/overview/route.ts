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

  const today = new Date();
  const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const startPrevMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const endPrevMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  const ninetyDaysAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 90));

  // Account-level rollup rows only (campaignId: null)
  const monthRows = await prisma.adsMetricDaily.findMany({
    where: { date: { gte: startOfMonth }, campaignId: null },
  });
  const prevMonthRows = await prisma.adsMetricDaily.findMany({
    where: { date: { gte: startPrevMonth, lte: endPrevMonth }, campaignId: null },
  });
  const trendRows = await prisma.adsMetricDaily.findMany({
    where: { date: { gte: ninetyDaysAgo }, campaignId: null },
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

  // Top 5 campaigns MTD by cost
  const topCampaignsData = await prisma.adsMetricDaily.groupBy({
    by: ["campaignId"],
    where: { date: { gte: startOfMonth }, campaignId: { not: null } },
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

  return NextResponse.json({
    mtd,
    prev,
    trend: trendRows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      costMYR: Number(r.costMicros) / 1_000_000,
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      conversions: Number(r.conversions),
    })),
    topCampaigns,
  });
}
