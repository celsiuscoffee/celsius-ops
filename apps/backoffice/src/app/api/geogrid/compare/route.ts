import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { placeDetails, buildSuggestions } from "@/lib/geogrid/places";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/geogrid/compare — profile diff + concrete actions to out-rank a rival.
// Body: { competitorPlaceId, ourPlaceId? }. ourPlaceId is the scan's target place
// id; when absent we still return the rival's strengths + generic advice.
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const competitorPlaceId: string = body.competitorPlaceId;
  const ourPlaceId: string | null = body.ourPlaceId ?? null;
  if (!competitorPlaceId) {
    return NextResponse.json({ error: "No Google profile id for this competitor" }, { status: 400 });
  }

  try {
    const them = await placeDetails(apiKey, competitorPlaceId);
    let us = null;
    if (ourPlaceId) {
      try {
        us = await placeDetails(apiKey, ourPlaceId);
      } catch (err) {
        console.error("[geogrid] own profile lookup failed:", (err as Error).message);
      }
    }
    return NextResponse.json({ us, them, suggestions: buildSuggestions(us, them) });
  } catch (err) {
    console.error("[geogrid] compare failed:", (err as Error).message);
    return NextResponse.json({ error: "Profile lookup failed" }, { status: 500 });
  }
}
