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
  const days = Number(url.searchParams.get("days") ?? "30");
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);

  const campaigns = await prisma.adsCampaign.findMany({
    orderBy: { name: "asc" },
    include: {
      account: { select: { customerId: true, descriptiveName: true } },
    },
  });

  // Aggregate metrics per campaign
  const metrics = await prisma.adsMetricDaily.groupBy({
    by: ["campaignId"],
    where: { date: { gte: from }, campaignId: { in: campaigns.map((c) => c.id) } },
    _sum: { costMicros: true, clicks: true, impressions: true, conversions: true },
  });
  const mMap = new Map(metrics.map((m) => [m.campaignId!, m._sum]));

  // Resolve outletId → name
  const outletIds = Array.from(new Set(campaigns.map((c) => c.outletId).filter((x): x is string => !!x)));
  const outlets = outletIds.length
    ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
    : [];
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  return NextResponse.json({
    campaigns: campaigns.map((c) => {
      const m = mMap.get(c.id);
      const cost = Number(m?.costMicros ?? 0) / 1_000_000;
      const clicks = Number(m?.clicks ?? 0);
      const imp = Number(m?.impressions ?? 0);
      const conv = Number(m?.conversions ?? 0);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        channelType: c.advertisingChannelType,
        outletId: c.outletId,
        outletName: c.outletId ? outletMap.get(c.outletId) ?? null : null,
        accountName: c.account.descriptiveName,
        costMYR: cost,
        clicks,
        impressions: imp,
        conversions: conv,
        ctr: imp > 0 ? clicks / imp : 0,
        cpaMYR: conv > 0 ? cost / conv : null,
      };
    }),
    days,
  });
}

export async function PATCH(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as { campaignId: string; outletId: string | null };
  if (!body.campaignId) return NextResponse.json({ error: "campaignId required" }, { status: 400 });

  await prisma.adsCampaign.update({
    where: { id: body.campaignId },
    data: { outletId: body.outletId },
  });
  return NextResponse.json({ ok: true });
}
