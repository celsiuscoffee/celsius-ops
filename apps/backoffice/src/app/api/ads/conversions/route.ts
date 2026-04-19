import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}

// Returns conversion breakdown by category for the selected filters.
// Respects outletId + campaignId + date range (same as /api/ads/overview).
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const outletId = url.searchParams.get("outletId");
  const campaignId = url.searchParams.get("campaignId");

  const today = new Date();
  const startOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const from = parseDate(url.searchParams.get("from")) ?? startOfMonth;
  const to = parseDate(url.searchParams.get("to")) ?? today;
  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 59, 999);

  // Resolve campaign filter
  let campaignIdFilter: string[] | undefined;
  if (campaignId && campaignId !== "all") {
    campaignIdFilter = [campaignId];
  } else if (outletId && outletId !== "all") {
    const where = outletId === "unlinked" ? { outletId: null } : { outletId };
    const cs = await prisma.adsCampaign.findMany({ where, select: { id: true } });
    campaignIdFilter = cs.map((c) => c.id);
    if (campaignIdFilter.length === 0) {
      return NextResponse.json({ byCategory: [], byAction: [] });
    }
  }

  const where = {
    date: { gte: from, lte: to },
    ...(campaignIdFilter ? { campaignId: { in: campaignIdFilter } } : {}),
  };

  // Aggregate by category
  const byCategory = await prisma.adsConversionDaily.groupBy({
    by: ["conversionCategory"],
    where,
    _sum: { conversions: true, conversionsValue: true },
    orderBy: { _sum: { conversions: "desc" } },
  });

  // Aggregate by individual action (for detail)
  const byAction = await prisma.adsConversionDaily.groupBy({
    by: ["conversionActionName", "conversionCategory"],
    where,
    _sum: { conversions: true, conversionsValue: true },
    orderBy: { _sum: { conversions: "desc" } },
    take: 20,
  });

  return NextResponse.json({
    byCategory: byCategory.map((r) => ({
      category: r.conversionCategory,
      conversions: Number(r._sum.conversions ?? 0),
      value: Number(r._sum.conversionsValue ?? 0),
    })),
    byAction: byAction.map((r) => ({
      name: r.conversionActionName,
      category: r.conversionCategory,
      conversions: Number(r._sum.conversions ?? 0),
      value: Number(r._sum.conversionsValue ?? 0),
    })),
  });
}
