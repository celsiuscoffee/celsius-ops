import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { configForOutlet } from "@/lib/seo/geogrid-config";
import { runGeogridForKeyword } from "@/lib/seo/geogrid";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Weekly geogrid sweep: reconstruct each outlet's map-pack rank around a grid
// of points (Places Text Search), store a snapshot per (outlet, keyword) with
// the precomputed ATRP / SoLV / #1-reach metrics.
//
// See docs/design/gbp-geogrid-rank-loop.md. Billed per Places call — the cap
// below is a hard ceiling so a misconfigured grid can't run up a huge bill.
//
// Manual / partial runs: GET ?outlet=<code|name-substring>&keyword=<text>
// (still requires the cron bearer). Useful for re-sweeping one outlet without
// spending on all four.
const MAX_CALLS_PER_RUN = 2500; // ~1.5× the default 1,620-call full sweep

type KeywordResult = {
  keyword: string;
  atrp?: number;
  solv?: number;
  oneReachKm?: number;
  calls: number;
  error?: string;
};

type OutletResult = {
  outletId: string;
  outletName: string;
  keywords: KeywordResult[];
  skipped?: string;
};

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 500 });
  }

  const outletFilter = req.nextUrl.searchParams.get("outlet")?.toLowerCase() || null;
  const keywordFilter = req.nextUrl.searchParams.get("keyword")?.toLowerCase() || null;

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    include: { reviewSettings: true },
  });

  const results: OutletResult[] = [];
  let totalCalls = 0;

  for (const outlet of outlets) {
    if (outletFilter && !outlet.name.toLowerCase().includes(outletFilter) && outlet.code.toLowerCase() !== outletFilter) {
      continue;
    }

    const config = configForOutlet(outlet.name);
    if (!config) {
      results.push({ outletId: outlet.id, outletName: outlet.name, keywords: [], skipped: "no_geo_config" });
      continue;
    }
    if (outlet.lat == null || outlet.lng == null) {
      results.push({ outletId: outlet.id, outletName: outlet.name, keywords: [], skipped: "no_coordinates" });
      continue;
    }

    const centerLat = Number(outlet.lat);
    const centerLng = Number(outlet.lng);
    const targetPlaceId = outlet.reviewSettings?.gbpPlaceId ?? null;
    const keywords = keywordFilter
      ? config.keywords.filter((k) => k.text.toLowerCase() === keywordFilter)
      : config.keywords;

    const keywordResults: KeywordResult[] = [];

    for (const kw of keywords) {
      const projected = config.gridSize * config.gridSize;
      if (totalCalls + projected > MAX_CALLS_PER_RUN) {
        keywordResults.push({ keyword: kw.text, calls: 0, error: "call_cap_reached" });
        continue;
      }

      try {
        const { cells, metrics, callCount } = await runGeogridForKeyword({
          keyword: kw.text,
          centerLat,
          centerLng,
          gridSize: config.gridSize,
          spacingKm: config.spacingKm,
          biasRadiusM: config.biasRadiusM,
          targetPlaceId,
          apiKey,
        });
        totalCalls += callCount;

        await prisma.geoRankSnapshot.create({
          data: {
            outletId: outlet.id,
            keyword: kw.text,
            keywordKind: kw.kind,
            gridSize: config.gridSize,
            spacingKm: config.spacingKm,
            biasRadiusM: config.biasRadiusM,
            cells: cells.map((c) => ({
              row: c.row,
              col: c.col,
              lat: Number(c.lat.toFixed(6)),
              lng: Number(c.lng.toFixed(6)),
              rank: c.rank,
            })),
            atrp: metrics.atrp,
            solv: metrics.solv,
            oneReachKm: metrics.oneReachKm,
            foundCells: metrics.foundCells,
            totalCells: metrics.totalCells,
          },
        });

        keywordResults.push({
          keyword: kw.text,
          atrp: metrics.atrp,
          solv: metrics.solv,
          oneReachKm: metrics.oneReachKm,
          calls: callCount,
        });
      } catch (err) {
        console.error(`[geogrid-sweep] "${kw.text}" failed for ${outlet.name}:`, err);
        keywordResults.push({ keyword: kw.text, calls: 0, error: "sweep_failed" });
      }
    }

    results.push({ outletId: outlet.id, outletName: outlet.name, keywords: keywordResults });
  }

  return NextResponse.json({ ok: true, totalCalls, outlets: results });
}
