import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocationProfile } from "@/lib/reviews/gbp";

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
