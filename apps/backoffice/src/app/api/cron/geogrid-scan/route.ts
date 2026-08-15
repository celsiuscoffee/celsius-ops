import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { runScan, isDue, needScore, producedData, interleaveByOutlet, SCAN_STATUS_FAILED } from "@/lib/geogrid/scan-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly adaptive scan. Each active keyword×outlet is scanned only when "due"
// (working combos ~weekly, at-goal combos ~monthly), worst-ranking first, and
// only up to the monthly budget cap — so spend lands where rank needs improving.
const MONTHLY_CAP = Number(process.env.GEOGRID_MONTHLY_SCAN_CAP || 40);
// Attempts, unlike budget, DO count failures — the cap above only charges for
// scans that returned rank data, so this is what stops a wholly-broken outlet
// from retrying forever inside one run. Sized above MONTHLY_CAP so a healthy
// run is never clipped by it.
const MAX_ATTEMPTS_PER_RUN = Number(process.env.GEOGRID_MAX_ATTEMPTS_PER_RUN || 60);
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
  // Charge the cap for scans that actually returned rank data. A `failed` scan
  // (every grid point errored) bought nothing, so counting it spends the budget
  // twice over: once on the wasted call, and again by blocking a combo that
  // would have succeeded until the month rolls over.
  const scansThisMonth = await prisma.geoGridScan.count({
    where: { createdAt: { gte: monthStart }, status: { not: SCAN_STATUS_FAILED } },
  });
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
  // Then take one combo per outlet in turn, so the neediest outlet leads but
  // never consumes the whole run before the others are reached.
  const queue = interleaveByOutlet(due);

  const results: { outlet: string; keyword: string; avgRank?: number | null; pctTop3?: number | null; status?: string; error?: string }[] = [];
  let attempts = 0;
  for (const c of queue) {
    if (budget <= 0 || attempts >= MAX_ATTEMPTS_PER_RUN) break;
    attempts++;
    try {
      const { scan } = await runScan({
        outletId: c.outletId,
        keyword: c.keyword,
        gridSize: GRID_SIZE,
        rangeMiles: RANGE_MILES,
        apiKey,
        createdBy: "auto-loop",
      });
      results.push({ outlet: c.outletName, keyword: c.keyword, avgRank: scan.avgRank, pctTop3: scan.pctTop3, status: scan.status });
      // Only a scan that returned data is charged to the budget.
      if (producedData(scan.status)) budget--;
    } catch (err) {
      results.push({ outlet: c.outletName, keyword: c.keyword, error: (err as Error).message });
    }
  }

  // `failed` and `error` are different shapes of nothing: the first stored a
  // row with no rank, the second never got as far as storing one. Report both
  // so a run that "scanned 40" can't hide that half of them came back empty.
  const failed = results.filter((r) => r.status === SCAN_STATUS_FAILED).length;
  const errored = results.filter((r) => r.error).length;
  return NextResponse.json({
    ran_at: now.toISOString(),
    monthlyCap: MONTHLY_CAP,
    dueCombos: due.length,
    attempts,
    scanned: results.filter((r) => !r.error && producedData(r.status ?? "")).length,
    failed,
    errored,
    attemptCeilingHit: attempts >= MAX_ATTEMPTS_PER_RUN,
    remainingBudget: Math.max(0, budget),
    results,
  });
}
