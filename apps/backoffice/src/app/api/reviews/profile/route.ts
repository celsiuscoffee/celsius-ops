import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocationProfile, updateLocationProfile } from "@/lib/reviews/gbp";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function locationFor(outletId: string): Promise<string | null> {
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, include: { reviewSettings: true } });
  return outlet?.reviewSettings?.gbpLocationName ?? null;
}

// GET /api/reviews/profile?outletId=... — current website/description/hours state.
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outletId = new URL(request.url).searchParams.get("outletId");
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });
  const locationName = await locationFor(outletId);
  if (!locationName) return NextResponse.json({ error: "Outlet has no GBP location connected" }, { status: 400 });

  try {
    const profile = await getLocationProfile(locationName);
    return NextResponse.json({ profile });
  } catch (err) {
    console.error("[reviews/profile] read failed:", (err as Error).message);
    return NextResponse.json({ error: "Could not read profile" }, { status: 500 });
  }
}

// POST /api/reviews/profile — apply website and/or description to the live profile.
// Body: { outletId, websiteUri?, description? }
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const outletId: string = body.outletId;
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const fields: { websiteUri?: string; description?: string } = {};
  if (typeof body.websiteUri === "string" && body.websiteUri.trim()) fields.websiteUri = body.websiteUri.trim();
  if (typeof body.description === "string" && body.description.trim()) fields.description = body.description.trim();
  if (!Object.keys(fields).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const locationName = await locationFor(outletId);
  if (!locationName) return NextResponse.json({ error: "Outlet has no GBP location connected" }, { status: 400 });

  try {
    await updateLocationProfile(locationName, fields);
    const profile = await getLocationProfile(locationName);
    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    console.error("[reviews/profile] update failed:", (err as Error).message);
    return NextResponse.json({ error: "Could not update profile" }, { status: 500 });
  }
}
