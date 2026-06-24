import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocationGeo } from "@/lib/reviews/gbp";
import { buildGrid, scanGrid, computeMetrics } from "@/lib/geogrid/places";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const METERS_PER_MILE = 1609.34;

// GET /api/geogrid/scan?outletId=...&keyword=... — recent scans (with points) for trend.
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const outletId = url.searchParams.get("outletId");
  const keyword = url.searchParams.get("keyword");
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const scans = await prisma.geoGridScan.findMany({
    where: { outletId, ...(keyword ? { keyword } : {}) },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  return NextResponse.json({ scans, keyConfigured: !!process.env.GOOGLE_PLACES_API_KEY });
}

// POST /api/geogrid/scan — run a fresh grid scan.
// Body: { outletId, keyword, gridSize?=9, rangeMiles?=0.1 }
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_PLACES_API_KEY not configured — set it + enable Places API on project 23036 to run scans." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const outletId: string = body.outletId;
  const keyword: string = (body.keyword || "").trim();
  const gridSize: number = [5, 7, 9, 11, 13].includes(body.gridSize) ? body.gridSize : 9;
  const rangeMiles: number = typeof body.rangeMiles === "number" && body.rangeMiles > 0 ? body.rangeMiles : 0.1;
  if (!outletId || !keyword) {
    return NextResponse.json({ error: "outletId and keyword required" }, { status: 400 });
  }

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    include: { reviewSettings: true },
  });
  if (!outlet?.reviewSettings?.gbpLocationName) {
    return NextResponse.json({ error: "Outlet has no GBP location connected" }, { status: 400 });
  }

  // Resolve centre + target Places id from the GBP location. GBP doesn't always
  // expose latlng, so fall back to the outlet's own stored coordinates, and to
  // the outlet name for matching when there's no Place id.
  let geo: { lat: number | null; lng: number | null; placeId: string | null; title: string | null } = {
    lat: null, lng: null, placeId: null, title: null,
  };
  try {
    geo = await getLocationGeo(outlet.reviewSettings.gbpLocationName);
  } catch (err) {
    console.error("[geogrid] GBP location info failed, falling back to outlet coords:", err);
  }

  const centerLat = geo.lat ?? (outlet.lat != null ? Number(outlet.lat) : null);
  const centerLng = geo.lng ?? (outlet.lng != null ? Number(outlet.lng) : null);
  if (centerLat == null || centerLng == null) {
    return NextResponse.json(
      { error: "No coordinates for this outlet (set its lat/lng, or fix its Google profile)" },
      { status: 400 },
    );
  }
  const targetTitle = geo.title ?? outlet.name;

  const points = buildGrid(centerLat, centerLng, gridSize, rangeMiles);
  const radiusM = Math.min(Math.max(rangeMiles * METERS_PER_MILE, 500), 5000);

  const { points: scanned, failures } = await scanGrid(
    apiKey,
    keyword,
    points,
    radiusM,
    geo.placeId,
    targetTitle,
  );
  const metrics = computeMetrics(scanned, centerLat, centerLng);

  const scan = await prisma.geoGridScan.create({
    data: {
      outletId,
      keyword,
      gridSize,
      rangeMiles,
      centerLat,
      centerLng,
      placeId: geo.placeId,
      status: failures === 0 ? "complete" : failures < points.length ? "partial" : "failed",
      points: scanned,
      avgRank: metrics.avgRank,
      pctTop3: metrics.pctTop3,
      foundPoints: metrics.foundPoints,
      totalPoints: metrics.totalPoints,
      greenRadiusM: metrics.greenRadiusM,
      createdBy: user.name || user.id,
    },
  });

  return NextResponse.json({ scan, failures });
}
