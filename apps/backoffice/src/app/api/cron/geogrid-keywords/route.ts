import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { refreshKeywords, seedTargetKeywords } from "@/lib/geogrid/keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Monthly: each active outlet's tracked geogrid keywords. Two layers:
//  1. seed the curated, demand-ranked floor from the Ads search-terms report
//     (every active outlet, GBP-connected or not), then
//  2. for GBP-connected outlets, add the live top terms from the Performance API.
// Branded/navigational and competitor-brand terms are filtered out throughout.
const TOP_N = Number(process.env.GEOGRID_KEYWORDS_PER_OUTLET || 4);

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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

  return NextResponse.json({ ran_at: new Date().toISOString(), topN: TOP_N, results });
}
