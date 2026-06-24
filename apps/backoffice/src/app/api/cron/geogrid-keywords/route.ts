import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { prisma } from "@/lib/prisma";
import { refreshKeywords } from "@/lib/geogrid/keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Monthly: auto-select each outlet's tracked geogrid keywords from the GBP
// Performance API (the terms customers actually searched), branded/nav filtered.
const TOP_N = Number(process.env.GEOGRID_KEYWORDS_PER_OUTLET || 4);

export async function GET(req: NextRequest) {
  const auth = checkCronAuth(req.headers);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    include: { reviewSettings: true },
  });
  const connected = outlets.filter((o) => o.reviewSettings?.gbpLocationName);

  const results = [];
  for (const o of connected) {
    const r = await refreshKeywords(o.id, TOP_N);
    results.push({ outlet: o.name, ...r });
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), topN: TOP_N, results });
}
