import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/ads/indeed/overview?from=2026-01-01&to=2026-05-18
// Returns per-outlet spend rollup + per-job breakdown for the window.
export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN", "OWNER", "MANAGER");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), 0, 1);

  const from = parseDate(searchParams.get("from")) ?? defaultFrom;
  const to   = parseDate(searchParams.get("to"))   ?? today;

  const metrics = await prisma.indeedAdsMetricDaily.findMany({
    where: { date: { gte: from, lte: to } },
    include: { job: { include: { outlet: { select: { id: true, code: true, name: true } } } } },
  });

  // Per-outlet rollup
  const byOutletId = new Map<string | "unassigned", {
    outletId:    string | null;
    outletName:  string;
    spendUsd:    number;
    impressions: number;
    clicks:      number;
    applies:     number;
  }>();

  for (const m of metrics) {
    const key  = m.job.outletId ?? "unassigned";
    const name = m.job.outlet?.name ?? (m.job.locationCity ? `${m.job.locationCity} (unmapped)` : "Unassigned");
    const row  = byOutletId.get(key) ?? {
      outletId:    m.job.outletId,
      outletName:  name,
      spendUsd:    0,
      impressions: 0,
      clicks:      0,
      applies:     0,
    };
    row.spendUsd    += Number(m.spendUsd);
    row.impressions += Number(m.impressions);
    row.clicks      += Number(m.clicks);
    row.applies     += Number(m.applies);
    byOutletId.set(key, row);
  }

  // Per-job breakdown
  const byJob = new Map<string, {
    jobId:        string;
    title:        string;
    city:         string | null;
    outletName:   string | null;
    spendUsd:     number;
    impressions:  number;
    clicks:       number;
    applies:      number;
  }>();
  for (const m of metrics) {
    const row = byJob.get(m.jobId) ?? {
      jobId:       m.jobId,
      title:       m.job.title,
      city:        m.job.locationCity,
      outletName:  m.job.outlet?.name ?? null,
      spendUsd:    0,
      impressions: 0,
      clicks:      0,
      applies:     0,
    };
    row.spendUsd    += Number(m.spendUsd);
    row.impressions += Number(m.impressions);
    row.clicks      += Number(m.clicks);
    row.applies     += Number(m.applies);
    byJob.set(m.jobId, row);
  }

  // Daily trend (spend + applies per date) for the chart
  const byDate = new Map<string, { date: string; spendUsd: number; applies: number; clicks: number }>();
  for (const m of metrics) {
    const key = m.date.toISOString().slice(0, 10);
    const row = byDate.get(key) ?? { date: key, spendUsd: 0, applies: 0, clicks: 0 };
    row.spendUsd += Number(m.spendUsd);
    row.applies  += Number(m.applies);
    row.clicks   += Number(m.clicks);
    byDate.set(key, row);
  }
  const trend = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  const lastSync = await prisma.indeedAdsSyncLog.findFirst({
    orderBy: { startedAt: "desc" },
  });

  return NextResponse.json({
    window:    { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    byOutlet:  Array.from(byOutletId.values()).sort((a, b) => b.spendUsd - a.spendUsd),
    byJob:     Array.from(byJob.values()).sort((a, b) => b.spendUsd - a.spendUsd),
    trend,
    lastSync:  lastSync ? {
      kind:   lastSync.kind,
      status: lastSync.status,
      at:     lastSync.finishedAt ?? lastSync.startedAt,
    } : null,
  });
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
