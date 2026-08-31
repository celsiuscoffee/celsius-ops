import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { runScan, isDue, needScore, producedData, interleaveByOutlet, SCAN_STATUS_FAILED } from "@/lib/geogrid/scan-runner";
import { buildAndSendLocalRankDigest } from "@/lib/geogrid/weekly-digest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly adaptive scan. Each active keyword×outlet is scanned only when "due"
// (working combos ~weekly, at-goal combos ~monthly), worst-ranking first, and
// only up to the monthly budget cap — so spend lands where rank needs improving.
//
// Cap sizing: the tracked set is pruned to ~40 combos (Keyword Strategy board,
// 2026-08-19). Weekly cadence on a working set that size needs ~160 data-bearing
// scans/month; the old default of 40 meant one run exhausted the month and no
// combo was ever re-measured — the loop produced breadth, never trends. Each
// run is still bounded by RUN_DEADLINE_MS (~40 scans), so the cap spreads
// across the weekly firings rather than being spent in one.
const MONTHLY_CAP = Number(process.env.GEOGRID_MONTHLY_SCAN_CAP || 160);
// Attempts, unlike budget, DO count failures — the cap above only charges for
// scans that returned rank data, so this is what stops a wholly-broken outlet
// from retrying forever inside one run. Sized above MONTHLY_CAP so a healthy
// run is never clipped by it.
const MAX_ATTEMPTS_PER_RUN = Number(process.env.GEOGRID_MAX_ATTEMPTS_PER_RUN || 60);
// Stop starting new scans this far into the run. maxDuration is 300s and a
// rate-limited scan now backs off rather than failing fast, so leave room to
// finish the one in flight instead of being killed mid-scan.
const RUN_DEADLINE_MS = Number(process.env.GEOGRID_RUN_DEADLINE_MS || 240_000);
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

  // An outlet with no GBP location connected can never scan — runScan throws on
  // it every time. Filtering here rather than letting it throw means it doesn't
  // burn an attempt per keyword per run, and the reason is reported once instead
  // of as N identical errors. (This is why IOI Mall, 16 active keywords, had
  // never produced a single scan.)
  const keywords = await prisma.geoGridKeyword.findMany({
    where: { active: true, outlet: { status: "ACTIVE" } },
    include: { outlet: { select: { name: true, reviewSettings: { select: { gbpLocationName: true } } } } },
  });
  const unconnected = [
    ...new Set(keywords.filter((k) => !k.outlet.reviewSettings?.gbpLocationName).map((k) => k.outlet.name)),
  ];
  const scannable = keywords.filter((k) => k.outlet.reviewSettings?.gbpLocationName);

  // Which combos are due, and how badly they need it (warmest-first). The
  // previous scan's numbers ride along so the weekly digest can report each
  // re-scan as a movement (#5.2 → #4.1) rather than a bare reading.
  const due: {
    outletId: string; outletName: string; keyword: string; score: number;
    hasPrior: boolean; prevRank: number | null; prevTop3: number | null;
  }[] = [];
  for (const k of scannable) {
    const last = await prisma.geoGridScan.findFirst({
      where: { outletId: k.outletId, keyword: k.keyword },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, pctTop3: true, avgRank: true },
    });
    if (isDue(last, now)) {
      due.push({
        outletId: k.outletId,
        outletName: k.outlet.name,
        keyword: k.keyword,
        score: needScore(last),
        hasPrior: last != null,
        prevRank: last?.avgRank ?? null,
        prevTop3: last?.pctTop3 ?? null,
      });
    }
  }
  due.sort((a, b) => b.score - a.score);
  // Re-scan reservation: never-scanned combos carry the max needScore, so a
  // burst of new keywords used to eat the whole deadline-bounded run and no
  // combo ever got a SECOND measurement — the loop had breadth but no trends.
  // Alternate re-scans with first-scans (re-scan first: a trend point beats a
  // new baseline when the question is "is rank improving?"), each stream
  // outlet-interleaved so the neediest outlet leads without monopolising.
  const repeats = interleaveByOutlet(due.filter((c) => c.hasPrior));
  const virgins = interleaveByOutlet(due.filter((c) => !c.hasPrior));
  const queue: typeof due = [];
  for (let i = 0; i < Math.max(repeats.length, virgins.length); i++) {
    if (i < repeats.length) queue.push(repeats[i]);
    if (i < virgins.length) queue.push(virgins[i]);
  }

  const results: {
    outlet: string; keyword: string; avgRank?: number | null; pctTop3?: number | null;
    prevRank?: number | null; prevTop3?: number | null; status?: string; error?: string; why?: string;
  }[] = [];
  let attempts = 0;
  let retries = 0;
  let deadlineHit = false;
  for (const c of queue) {
    if (budget <= 0 || attempts >= MAX_ATTEMPTS_PER_RUN) break;
    // Retries make a rate-limited run longer than an unimpeded one, so stop
    // issuing new scans before the function's own ceiling cuts one off midway
    // and loses the work already paid for.
    if (Date.now() - now.getTime() > RUN_DEADLINE_MS) { deadlineHit = true; break; }
    attempts++;
    try {
      const { scan, sampleError, retries: scanRetries } = await runScan({
        outletId: c.outletId,
        keyword: c.keyword,
        gridSize: GRID_SIZE,
        rangeMiles: RANGE_MILES,
        apiKey,
        createdBy: "auto-loop",
      });
      retries += scanRetries;
      results.push({
        outlet: c.outletName, keyword: c.keyword, avgRank: scan.avgRank, pctTop3: scan.pctTop3,
        prevRank: c.prevRank, prevTop3: c.prevTop3, status: scan.status,
        // Why a scan came back empty — without this a rate-limit is
        // indistinguishable from a broken outlet, which is exactly how this
        // went undiagnosed for two months.
        ...(sampleError ? { why: sampleError.slice(0, 200) } : {}),
      });
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

  // Weekly digest to the owner's Telegram — the loop reports its own progress
  // (rank movements, review velocity vs target, ads guardrail). Best-effort:
  // a digest failure never fails the scan run that feeds it.
  let digestSent = false;
  try {
    const sent = await buildAndSendLocalRankDigest(
      results
        .filter((r) => !r.error && producedData(r.status ?? ""))
        .map((r) => ({
          outlet: r.outlet,
          keyword: r.keyword,
          avgRank: r.avgRank ?? null,
          pctTop3: r.pctTop3 ?? null,
          prevRank: r.prevRank ?? null,
          prevTop3: r.prevTop3 ?? null,
        })),
    );
    digestSent = sent != null;
  } catch (err) {
    console.error("[geogrid-scan] weekly digest failed", err);
  }

  return NextResponse.json({
    digestSent,
    ran_at: now.toISOString(),
    monthlyCap: MONTHLY_CAP,
    dueCombos: due.length,
    rescansDue: repeats.length,
    firstScansDue: virgins.length,
    attempts,
    scanned: results.filter((r) => !r.error && producedData(r.status ?? "")).length,
    failed,
    errored,
    retries,
    attemptCeilingHit: attempts >= MAX_ATTEMPTS_PER_RUN,
    deadlineHit,
    // Outlets that can never scan until someone connects their Google profile.
    ...(unconnected.length ? { skippedNoGbpLocation: unconnected } : {}),
    remainingBudget: Math.max(0, budget),
    results,
  });
}
