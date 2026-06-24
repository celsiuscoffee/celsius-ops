import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { goalForOutlet } from "@/lib/seo/geogrid-goals";

export const dynamic = "force-dynamic";

// GET /api/seo/dashboard
//
// All-outlets roll-up for the SEO command view. For each active outlet we take
// the latest snapshot per keyword, headline on the GENERIC "near me" keywords
// (the radius game), and report the outlet-level #1-reach / SoLV / ATRP with a
// week-over-week delta and goal status.

type Snap = {
  keyword: string;
  keywordKind: string;
  oneReachKm: number;
  solv: number;
  atrp: number;
  capturedAt: Date;
};

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    outlets.map(async (outlet) => {
      const snaps = (await prisma.geoRankSnapshot.findMany({
        where: { outletId: outlet.id },
        select: { keyword: true, keywordKind: true, oneReachKm: true, solv: true, atrp: true, capturedAt: true },
        orderBy: { capturedAt: "desc" },
        take: 120,
      })) as Snap[];

      if (snaps.length === 0) {
        return { outletId: outlet.id, name: outlet.name, hasData: false, goal: goalForOutlet(outlet.name) };
      }

      // Latest + previous snapshot per keyword.
      const latestByKw = new Map<string, Snap>();
      const prevByKw = new Map<string, Snap>();
      for (const s of snaps) {
        if (!latestByKw.has(s.keyword)) latestByKw.set(s.keyword, s);
        else if (!prevByKw.has(s.keyword)) prevByKw.set(s.keyword, s);
      }

      // Headline on generic keywords; fall back to all if none are tagged generic.
      const allLatest = [...latestByKw.values()];
      const generic = allLatest.filter((s) => s.keywordKind === "generic");
      const headline = generic.length ? generic : allLatest;
      const headlineKws = new Set(headline.map((s) => s.keyword));
      const prev = [...prevByKw.values()].filter((s) => headlineKws.has(s.keyword));

      const oneReachKm = mean(headline.map((s) => s.oneReachKm));
      const solv = mean(headline.map((s) => s.solv));
      const atrp = mean(headline.map((s) => s.atrp));
      const goal = goalForOutlet(outlet.name);
      const sweptAt = snaps[0].capturedAt;

      return {
        outletId: outlet.id,
        name: outlet.name,
        hasData: true,
        keywordCount: latestByKw.size,
        sweptAt,
        oneReachKm: Number(oneReachKm.toFixed(2)),
        solv: Number(solv.toFixed(1)),
        atrp: Number(atrp.toFixed(1)),
        oneReachDelta: prev.length ? Number((oneReachKm - mean(prev.map((s) => s.oneReachKm))).toFixed(2)) : null,
        solvDelta: prev.length ? Number((solv - mean(prev.map((s) => s.solv))).toFixed(1)) : null,
        goal,
        metCommitted: solv >= goal.solvTarget,
        metStretch: oneReachKm >= goal.oneReachTargetKm,
      };
    }),
  );

  const withData = rows.filter((r) => r.hasData);
  const summary = {
    outlets: rows.length,
    withData: withData.length,
    metCommitted: withData.filter((r) => "metCommitted" in r && r.metCommitted).length,
    metStretch: withData.filter((r) => "metStretch" in r && r.metStretch).length,
  };

  return NextResponse.json({ rows, summary });
}
