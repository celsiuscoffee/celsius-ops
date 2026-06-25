import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocationProfile, updateLocationProfile } from "@/lib/reviews/gbp";
import { generateDescription } from "@/lib/reviews/profile-content";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Hands-off profile completeness: if a connected outlet has no Google
// description, draft one and push it. Idempotent (outlets that already have a
// description are skipped) and additive (only sets the description field; never
// touches website or hours, which we can't know without the owner).
const MAX_TOTAL = 30;

type OutletResult = { outletId: string; outletName: string; set: boolean; skipped?: string; error?: string };

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) {
    const user = await getUserFromHeaders(req.headers);
    if (!user) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ skipped: "ANTHROPIC_API_KEY not set" });
  }

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    include: { reviewSettings: true },
  });
  const connected = outlets.filter((o) => o.reviewSettings?.gbpLocationName);

  const results: OutletResult[] = [];
  let set = 0;

  for (const outlet of connected) {
    if (set >= MAX_TOTAL) break;
    const locationName = outlet.reviewSettings!.gbpLocationName!;
    try {
      const profile = await getLocationProfile(locationName);
      if (profile.description) {
        results.push({ outletId: outlet.id, outletName: outlet.name, set: false, skipped: "already_set" });
        continue;
      }
      const keywords = await prisma.geoGridKeyword.findMany({
        where: { outletId: outlet.id, active: true },
        select: { keyword: true },
      });
      const description = await generateDescription({
        outletName: outlet.name,
        city: outlet.city,
        keywords: keywords.map((k) => k.keyword),
      });
      if (!description) {
        results.push({ outletId: outlet.id, outletName: outlet.name, set: false, error: "empty_copy" });
        continue;
      }
      await updateLocationProfile(locationName, { description });
      set++;
      results.push({ outletId: outlet.id, outletName: outlet.name, set: true });
    } catch (err) {
      console.error(`[reviews-profile-autofill] failed for outlet ${outlet.name}:`, err);
      results.push({ outletId: outlet.id, outletName: outlet.name, set: false, error: "update_failed" });
    }
  }

  return NextResponse.json({ ran_at: new Date().toISOString(), outlets_connected: connected.length, descriptions_set: set, results });
}
