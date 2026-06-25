import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rankAtPoint } from "@/lib/geogrid/places";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const METERS_PER_MILE = 1609.34;

// POST /api/geogrid/point — live "who ranks here" for a single grid point.
// Lets the UI drill into older scans that predate stored per-point results, and
// into the unranked (grey) points where we're outside the top 20 but rivals exist.
// Body: { outletId, keyword, lat, lng, rangeMiles?, placeId? }
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const outletId: string = body.outletId;
  const keyword: string = (body.keyword || "").trim();
  const lat = body.lat;
  const lng = body.lng;
  const placeId: string | null = body.placeId ?? null;
  if (!outletId || !keyword || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "outletId, keyword, lat and lng required" }, { status: 400 });
  }

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
  // Match the scan's radius clamp so the live lookup mirrors what produced the grid.
  const rangeMiles = typeof body.rangeMiles === "number" && body.rangeMiles > 0 ? body.rangeMiles : 0.1;
  const radiusM = Math.min(Math.max(rangeMiles * METERS_PER_MILE, 500), 5000);

  try {
    const { rank, results } = await rankAtPoint(apiKey, keyword, lat, lng, radiusM, placeId, outlet?.name ?? null);
    return NextResponse.json({ rank, results });
  } catch (err) {
    console.error("[geogrid] point lookup failed:", (err as Error).message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
