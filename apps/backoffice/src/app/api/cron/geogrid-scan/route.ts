import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { runScan, isDue, needScore } from "@/lib/geogrid/scan-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly adaptive scan. Each active keyword×outlet is scanned only when "due"
// (working combos ~weekly, at-goal combos ~monthly), worst-ranking first, and
// only up to the monthly budget cap — so spend lands where rank needs improving.
const MONTHLY_CAP = Number(process.env.GEOGRID_MONTHLY_SCAN_CAP || 40);
// Per-run ceiling: spreads the monthly budget across the weekly cron firings
// (~4/month) instead of burning it all on the first run of the month, and
// keeps one run's API volume + duration well inside quota and maxDuration.
const RUN_CAP = Number(process.env.GEOGRID_RUN_SCAN_CAP || 15);
const GRID_SIZE = Number(process.env.GEOGRID_GRID_SIZE || 9);
// 2.5km point spacing on a 9×9 grid = a ±10km catchment — the agreed target
// radius, and the same setting as the owner's manual baseline scans (1.553mi),
// so auto and manual scans stay comparable. The old 0.2mi default measured
// only ~±1.3km around the storefront, which trivially over-reports rank.
const RANGE_MILES = Number(process.env.GEOGRID_RANGE_MILES || 1.5534);

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ skipped: "GOOGLE_PLACES_API_KEY not set" });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  // Fully-failed scans collected no data — they must not eat the month's
  // budget, or one quota outage blacks the loop out until the 1st (happened
  // 2026-07-06: 20 failed scans burned half the cap in one run).
  const scansThisMonth = await prisma.geoGridScan.count({
    where: { createdAt: { gte: monthStart }, status: { not: "failed" } },
  });
  let budget = Math.min(RUN_CAP, MONTHLY_CAP - scansThisMonth);
  if (budget <= 0) {
    return NextResponse.json({ capped: true, monthlyCap: MONTHLY_CAP, scansThisMonth });
  }

  const keywords = await prisma.geoGridKeyword.findMany({
    where: { active: true, outlet: { status: "ACTIVE" } },
    include: { outlet: { select: { name: true } } },
  });

  // Which combos are due, and how badly they need it (warmest-first).
  // Cadence keys off the last scan that actually produced data — a failed
  // scan postponing the retry a full week would silently stale the combo.
  const due: { outletId: string; outletName: string; keyword: string; score: number }[] = [];
  for (const k of keywords) {
    const last = await prisma.geoGridScan.findFirst({
      where: { outletId: k.outletId, keyword: k.keyword, status: { not: "failed" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, pctTop3: true, avgRank: true },
    });
    if (isDue(last, now)) {
      due.push({ outletId: k.outletId, outletName: k.outlet.name, keyword: k.keyword, score: needScore(last) });
    }
  }
  due.sort((a, b) => b.score - a.score);

  const results: { outlet: string; keyword: string; avgRank?: number | null; pctTop3?: number | null; error?: string }[] = [];
  let consecutiveFullFails = 0;
  let outageAborted = false;
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
      if (scan.status === "failed") {
        // Every point failed even with retries — the API is down or the
        // quota is gone. One more strike and we stop burning calls; the
        // combos stay due and next week's run picks them back up.
        if (++consecutiveFullFails >= 2) {
          outageAborted = true;
          break;
        }
      } else {
        consecutiveFullFails = 0;
        budget--;
      }
    } catch (err) {
      results.push({ outlet: c.outletName, keyword: c.keyword, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    ran_at: now.toISOString(),
    monthlyCap: MONTHLY_CAP,
    runCap: RUN_CAP,
    dueCombos: due.length,
    scanned: results.filter((r) => !r.error).length,
    remainingBudget: Math.max(0, budget),
    ...(outageAborted ? { outageAborted: true } : {}),
    results,
  });
}
