import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocationProfile } from "@/lib/reviews/gbp";
import { targetKeywordsForOutlet, isCompetitorBrand, type TargetKeyword } from "@/lib/geogrid/target-keywords";
import { auditRelevance, inferLever } from "@/lib/geogrid/relevance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/geogrid/relevance?outletId=... — live per-keyword relevance audit:
// pulls the outlet's REAL Google Business Profile and diffs it against the
// target keyword set (curated demand-ranked floor + any tracked DB keywords).
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outletId = new URL(request.url).searchParams.get("outletId");
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    include: { reviewSettings: true },
  });
  if (!outlet) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  if (!outlet.reviewSettings?.gbpLocationName) {
    return NextResponse.json({
      connected: false,
      error: "Outlet has no Google Business Profile connected (Reviews → Settings).",
    });
  }

  // Curated floor (always available) + any active tracked keywords the loop has
  // added since (GeoGridKeyword may not be migrated yet — degrade gracefully).
  const targets: TargetKeyword[] = targetKeywordsForOutlet(outlet.name);
  try {
    const tracked = await prisma.geoGridKeyword.findMany({
      where: { outletId, active: true },
      select: { keyword: true, impressions: true },
    });
    const have = new Set(targets.map((t) => t.keyword));
    for (const k of tracked) {
      if (have.has(k.keyword) || isCompetitorBrand(k.keyword)) continue;
      targets.push({ keyword: k.keyword, clicks: k.impressions ?? 0, lever: inferLever(k.keyword) });
    }
  } catch {
    // table not migrated yet — the curated set is the audit
  }

  try {
    const profile = await getLocationProfile(outlet.reviewSettings.gbpLocationName);
    const report = auditRelevance(profile, targets);
    return NextResponse.json({ connected: true, outletName: outlet.name, ...report });
  } catch (err) {
    console.error("[geogrid] relevance audit failed:", err);
    return NextResponse.json(
      { connected: true, error: `GBP profile fetch failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
