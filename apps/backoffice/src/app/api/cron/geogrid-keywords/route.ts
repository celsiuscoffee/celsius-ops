import { NextResponse } from "next/server";
import { cronRoute } from "@/lib/cron-monitor";
import { prisma } from "@/lib/prisma";
import { refreshKeywords, seedTargetKeywords } from "@/lib/geogrid/keywords";
import { buildKeywordStrategy } from "@/lib/geogrid/keyword-selection";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Monthly: each active outlet's tracked geogrid keywords. Two layers:
//  1. seed the curated, demand-ranked floor from the Ads search-terms report
//     (every active outlet, GBP-connected or not), then
//  2. for GBP-connected outlets, add the live top terms from the Performance API.
// Branded/navigational and competitor-brand terms are filtered out throughout.
const TOP_N = Number(process.env.GEOGRID_KEYWORDS_PER_OUTLET || 4);

async function runGeogridKeywords() {
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    include: { reviewSettings: true },
  });

  const results = [];
  for (const o of outlets) {
    const seeded = await seedTargetKeywords(o.id, o.name);
    const auto = o.reviewSettings?.gbpLocationName ? await refreshKeywords(o.id, TOP_N) : null;
    results.push({ outlet: o.name, seeded: seeded.length, auto });
  }

  // Shadow: recompute the keyword-selection strategy from the scans so far and
  // log its shape. Read-only — retiring a keyword stays an approval click on
  // /reviews/geogrid/keywords, never automatic. Best-effort; never fails the seed.
  let strategy: Record<string, unknown> | null = null;
  try {
    const report = await buildKeywordStrategy();
    strategy = { mode: "shadow", summary: report.summary };
  } catch (e) {
    strategy = { error: (e as Error).message };
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), topN: TOP_N, results, strategy });
}

export const GET = cronRoute("geogrid-keywords", runGeogridKeywords);
