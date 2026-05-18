import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/ads/indeed/jobs
// Returns every IndeedAdsJob row joined with its outlet + lifetime metric totals.
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await prisma.indeedAdsJob.findMany({
    include: {
      outlet:  { select: { id: true, code: true, name: true } },
      metrics: { select: { impressions: true, clicks: true, applyStarts: true, applies: true, spendUsd: true } },
    },
    orderBy: [{ lastSyncedAt: "desc" }],
  });

  const rows = jobs.map(j => {
    const totals = j.metrics.reduce(
      (acc, m) => ({
        impressions: acc.impressions + Number(m.impressions),
        clicks:      acc.clicks + Number(m.clicks),
        applyStarts: acc.applyStarts + Number(m.applyStarts),
        applies:     acc.applies + Number(m.applies),
        spendUsd:    acc.spendUsd + Number(m.spendUsd),
      }),
      { impressions: 0, clicks: 0, applyStarts: 0, applies: 0, spendUsd: 0 },
    );
    return {
      id:           j.id,
      indeedJobId:  j.indeedJobId,
      title:        j.title,
      campaignName: j.campaignName,
      locationCity: j.locationCity,
      locationState:j.locationState,
      status:       j.status,
      premium:      j.premium,
      outletId:     j.outletId,
      outletName:   j.outlet?.name ?? null,
      lastSyncedAt: j.lastSyncedAt,
      ...totals,
    };
  });

  return NextResponse.json({ jobs: rows });
}
