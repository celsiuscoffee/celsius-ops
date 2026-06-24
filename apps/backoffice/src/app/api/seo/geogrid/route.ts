import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { goalForOutlet } from "@/lib/seo/geogrid-goals";

export const dynamic = "force-dynamic";

// GET /api/seo/geogrid?outletId=<id>&keyword=<text>
//
// Powers the Local Rank page. Returns the active outlets, the keywords that
// have snapshots for the selected outlet, the latest snapshot (with its full
// cell grid) for the selected outlet+keyword, and a short history of the
// headline metrics for the trend chart.
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const outletId = request.nextUrl.searchParams.get("outletId") || outlets[0]?.id || null;
  if (!outletId) {
    return NextResponse.json({ outlets, keywords: [], latest: null, history: [], goal: null });
  }

  const outletName = outlets.find((o) => o.id === outletId)?.name ?? "";
  const goal = goalForOutlet(outletName);

  // Keywords that actually have snapshots for this outlet (most-recent first).
  const recent = await prisma.geoRankSnapshot.findMany({
    where: { outletId },
    select: { keyword: true, keywordKind: true, capturedAt: true },
    orderBy: { capturedAt: "desc" },
    take: 200,
  });
  const seen = new Set<string>();
  const keywords: { text: string; kind: string }[] = [];
  for (const r of recent) {
    if (!seen.has(r.keyword)) {
      seen.add(r.keyword);
      keywords.push({ text: r.keyword, kind: r.keywordKind });
    }
  }

  const keyword = request.nextUrl.searchParams.get("keyword") || keywords[0]?.text || null;
  if (!keyword) {
    return NextResponse.json({ outlets, keywords, latest: null, history: [], goal });
  }

  const latest = await prisma.geoRankSnapshot.findFirst({
    where: { outletId, keyword },
    orderBy: { capturedAt: "desc" },
  });

  const historyRows = await prisma.geoRankSnapshot.findMany({
    where: { outletId, keyword },
    select: { capturedAt: true, atrp: true, solv: true, oneReachKm: true },
    orderBy: { capturedAt: "desc" },
    take: 12,
  });
  const history = historyRows.reverse(); // chronological for the chart

  return NextResponse.json({ outlets, keywords, selectedKeyword: keyword, latest, history, goal });
}
