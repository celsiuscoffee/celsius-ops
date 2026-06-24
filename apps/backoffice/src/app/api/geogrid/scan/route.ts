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

  const settings = await prisma.reviewSettings.findUnique({ where: { outletId } });
  if (!settings?.gbpLocationName) {
    return NextResponse.json({ error: "Outlet has no GBP location connected" }, { status: 400 });
  }

  // Resolve centre + target Places id from the GBP location.
  let geo;
  try {
    geo = await getLocationGeo(settings.gbpLocationName);
  } catch (err) {
    console.error("[geogrid] location geo failed:", err);
    return NextResponse.json({ error: "Could not resolve outlet location from Google" }, { status: 502 });
  }
  if (geo.lat == null || geo.lng == null) {
    return NextResponse.json({ error: "Outlet has no lat/lng on its Google profile" }, { status: 400 });
  }

  const points = buildGrid(geo.lat, geo.lng, gridSize, rangeMiles);
  const radiusM = Math.min(Math.max(rangeMiles * METERS_PER_MILE, 500), 5000);

  const { points: scanned, failures } = await scanGrid(
    apiKey,
    keyword,
    points,
    radiusM,
    geo.placeId,
    geo.title,
  );
  const metrics = computeMetrics(scanned, geo.lat, geo.lng);

  const scan = await prisma.geoGridScan.create({
    data: {
      outletId,
      keyword,
      gridSize,
      rangeMiles,
      centerLat: geo.lat,
      centerLng: geo.lng,
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
