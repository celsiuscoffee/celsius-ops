import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron-monitor";
import { prisma } from "@/lib/prisma";
import { runScan, isDue, needScore } from "@/lib/geogrid/scan-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly adaptive scan. Each active keyword×outlet is scanned only when "due"
// (working combos ~weekly, at-goal combos ~monthly), worst-ranking first, and
// only up to the monthly budget cap — so spend lands where rank needs improving.
const MONTHLY_CAP = Number(process.env.GEOGRID_MONTHLY_SCAN_CAP || 40);
const GRID_SIZE = Number(process.env.GEOGRID_GRID_SIZE || 9);
// 2.5km point spacing on a 9×9 grid = a ±10km catchment — the agreed target
// radius, and the same setting as the owner's manual baseline scans (1.553mi),
// so auto and manual scans stay comparable. The old 0.2mi default measured
// only ~±1.3km around the storefront, which trivially over-reports rank.
const RANGE_MILES = Number(process.env.GEOGRID_RANGE_MILES || 1.5534);

async function runGeogridScan() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ skipped: "GOOGLE_PLACES_API_KEY not set" });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const scansThisMonth = await prisma.geoGridScan.count({ where: { createdAt: { gte: monthStart } } });
  let budget = MONTHLY_CAP - scansThisMonth;
  if (budget <= 0) {
    return NextResponse.json({ capped: true, monthlyCap: MONTHLY_CAP, scansThisMonth });
  }

  const keywords = await prisma.geoGridKeyword.findMany({
    where: { active: true, outlet: { status: "ACTIVE" } },
    include: { outlet: { select: { name: true } } },
  });

  // Which combos are due, and how badly they need it (warmest-first).
  const due: { outletId: string; outletName: string; keyword: string; score: number }[] = [];
  for (const k of keywords) {
    const last = await prisma.geoGridScan.findFirst({
      where: { outletId: k.outletId, keyword: k.keyword },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, pctTop3: true, avgRank: true },
    });
    if (isDue(last, now)) {
      due.push({ outletId: k.outletId, outletName: k.outlet.name, keyword: k.keyword, score: needScore(last) });
    }
  }
  due.sort((a, b) => b.score - a.score);

  const results: { outlet: string; keyword: string; avgRank?: number | null; pctTop3?: number | null; error?: string }[] = [];
  for (const c of due) {
    if (budget <= 0) break;
    try {
      const { scan } = await runScan({
        outletId: c.outletId,
        keyword: c.keyword,
        gridSize: GRID_SIZE,
        rangeMiles: RANGE_MILES,
        apiKey,
        createdBy: "auto-loop",
      });
      results.push({ outlet: c.outletName, keyword: c.keyword, avgRank: scan.avgRank, pctTop3: scan.pctTop3 });
      budget--;
    } catch (err) {
      results.push({ outlet: c.outletName, keyword: c.keyword, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    ran_at: now.toISOString(),
    monthlyCap: MONTHLY_CAP,
    dueCombos: due.length,
    scanned: results.filter((r) => !r.error).length,
    remainingBudget: Math.max(0, budget),
    results,
  });
}

export const GET = cronRoute("geogrid-scan", runGeogridScan);
