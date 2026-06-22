import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  searchNearbyCafes,
  computeRanking,
  DEFAULT_RADIUS_M,
} from "@/lib/reviews/places";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET/POST /api/reviews/competitors/refresh
 *
 * Refreshes the Nearby Competitor Ranking cache (CompetitorSnapshot) from
 * Google Places Nearby Search. Runs on a daily Vercel cron AND from the
 * "Refresh" button in the Reviews dashboard.
 *
 * Auth: Vercel cron bearer (checkCronAuth) OR a logged-in backoffice user.
 * Query: ?outletId=<id> to refresh a single outlet (used by the button).
 *
 * Each active outlet with coordinates gets one Places call. We identify our own
 * outlet inside the nearby set (by stored Place ID, else name, else proximity)
 * and, when found, opportunistically backfill ReviewSettings.gbpPlaceId.
 */
async function handle(req: NextRequest) {
  const cron = checkCronAuth(req.headers);
  if (!cron.ok) {
    const user = await getUserFromHeaders(req.headers);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const onlyOutletId = req.nextUrl.searchParams.get("outletId");
  const radiusM = Number(req.nextUrl.searchParams.get("radius")) || DEFAULT_RADIUS_M;

  const outlets = await prisma.outlet.findMany({
    where: {
      status: "ACTIVE",
      ...(onlyOutletId ? { id: onlyOutletId } : {}),
    },
    include: { reviewSettings: true },
  });

  const results: Array<{
    outletId: string;
    outletName: string;
    ok: boolean;
    selfFound?: boolean;
    rankByReviews?: number | null;
    totalNearby?: number;
    error?: string;
  }> = [];

  for (const outlet of outlets) {
    if (outlet.lat == null || outlet.lng == null) {
      results.push({ outletId: outlet.id, outletName: outlet.name, ok: false, error: "No coordinates" });
      continue;
    }

    try {
      const cafes = await searchNearbyCafes(Number(outlet.lat), Number(outlet.lng), radiusM);
      const ranking = computeRanking(cafes, {
        selfPlaceId: outlet.reviewSettings?.gbpPlaceId ?? null,
        selfNameHint: outlet.name,
      });

      await prisma.competitorSnapshot.upsert({
        where: { outletId: outlet.id },
        create: {
          outletId: outlet.id,
          capturedAt: new Date(),
          radiusM,
          selfFound: ranking.selfFound,
          selfPlaceId: ranking.selfPlaceId,
          selfRating: ranking.selfRating,
          selfReviewCount: ranking.selfReviewCount,
          rankByReviews: ranking.rankByReviews,
          rankByRating: ranking.rankByRating,
          totalNearby: ranking.totalNearby,
          competitors: ranking.competitors,
        },
        update: {
          capturedAt: new Date(),
          radiusM,
          selfFound: ranking.selfFound,
          selfPlaceId: ranking.selfPlaceId,
          selfRating: ranking.selfRating,
          selfReviewCount: ranking.selfReviewCount,
          rankByReviews: ranking.rankByReviews,
          rankByRating: ranking.rankByRating,
          totalNearby: ranking.totalNearby,
          competitors: ranking.competitors,
        },
      });

      // Backfill the Place ID we just resolved so future self-matches are exact.
      if (ranking.selfFound && ranking.selfPlaceId && !outlet.reviewSettings?.gbpPlaceId && outlet.reviewSettings) {
        await prisma.reviewSettings.update({
          where: { outletId: outlet.id },
          data: { gbpPlaceId: ranking.selfPlaceId },
        });
      }

      results.push({
        outletId: outlet.id,
        outletName: outlet.name,
        ok: true,
        selfFound: ranking.selfFound,
        rankByReviews: ranking.rankByReviews,
        totalNearby: ranking.totalNearby,
      });
    } catch (e) {
      results.push({
        outletId: outlet.id,
        outletName: outlet.name,
        ok: false,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ refreshed: results.filter((r) => r.ok).length, total: results.length, results });
}

export const GET = handle;
export const POST = handle;
