import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews } from "@/lib/reviews/gbp";

// Outlet display order: Putrajaya first, Nilai last
const OUTLET_ORDER: Record<string, number> = {
  putrajaya: 0,
  "shah alam": 1,
  tamarind: 2,
  nilai: 99,
};

function outletSortKey(name: string): number {
  const lower = name.toLowerCase();
  for (const [key, order] of Object.entries(OUTLET_ORDER)) {
    if (lower.includes(key)) return order;
  }
  return 50; // default middle
}

// GET /api/reviews/dashboard?period=day|week|month|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = request.nextUrl.searchParams.get("period") || "month";
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");

  // Calculate date range
  const now = new Date();
  let since: Date;
  let until: Date | null = null;
  if (period === "custom" && fromParam) {
    since = new Date(fromParam + "T00:00:00");
    until = toParam ? new Date(toParam + "T23:59:59.999") : null;
  } else if (period === "day") {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === "week") {
    since = new Date(now);
    since.setDate(since.getDate() - 7);
    since.setHours(0, 0, 0, 0);
  } else {
    // month
    since = new Date(now);
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
  }

  // Fetch all active outlets with review settings
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    include: { reviewSettings: true },
  });

  // Sort outlets: Putrajaya first, Nilai last
  outlets.sort((a, b) => outletSortKey(a.name) - outletSortKey(b.name));

  // Fetch Google reviews for all connected outlets in parallel
  const googlePromises = outlets.map(async (outlet) => {
    const settings = outlet.reviewSettings;
    if (!settings?.gbpAccountId || !settings?.gbpLocationName) {
      return { outletId: outlet.id, outletName: outlet.name, reviews: [], connected: false, averageRating: 0, totalReviewCount: 0 };
    }
    try {
      const data = await fetchGoogleReviews(settings.gbpAccountId, settings.gbpLocationName, 50);
      // Filter by date
      const filtered = data.reviews.filter((r) => {
        const d = new Date(r.createdAt);
        return d >= since && (!until || d <= until);
      });
      // Period-based average rating
      const periodAvg = filtered.length
        ? filtered.reduce((sum, r) => sum + r.rating, 0) / filtered.length
        : 0;
      return {
        outletId: outlet.id,
        outletName: outlet.name,
        reviews: filtered,
        connected: true,
        averageRating: periodAvg,
        totalReviewCount: data.totalReviewCount,
      };
    } catch {
      return { outletId: outlet.id, outletName: outlet.name, reviews: [], connected: true, averageRating: 0, totalReviewCount: 0 };
    }
  });

  // Fetch internal feedback for all outlets in date range
  const feedbacks = await prisma.internalFeedback.findMany({
    where: { createdAt: { gte: since, ...(until ? { lte: until } : {}) } },
    orderBy: { createdAt: "desc" },
    include: { outlet: { select: { id: true, name: true } } },
  });

  const googleResults = await Promise.all(googlePromises);

  // Build per-outlet summaries
  const outletSummaries = outlets.map((outlet) => {
    const google = googleResults.find((g) => g.outletId === outlet.id);
    const outletFeedbacks = feedbacks.filter((f) => f.outletId === outlet.id);

    const fbStats = { total: outletFeedbacks.length, star5: 0, star4: 0, star3: 0, star2: 0, star1: 0 };
    for (const f of outletFeedbacks) {
      const key = `star${f.rating}` as keyof typeof fbStats;
      if (key in fbStats && key !== "total") (fbStats[key] as number)++;
    }

    return {
      outletId: outlet.id,
      outletName: outlet.name,
      google: {
        connected: google?.connected ?? false,
        reviews: google?.reviews ?? [],
        averageRating: google?.averageRating ?? 0,
        totalReviewCount: google?.totalReviewCount ?? 0,
        periodCount: google?.reviews.length ?? 0,
      },
      internal: {
        feedbacks: outletFeedbacks,
        stats: fbStats,
      },
    };
  });

  // Aggregate totals
  const totalGoogleReviews = outletSummaries.reduce((sum, o) => sum + o.google.periodCount, 0);
  const totalFeedbacks = feedbacks.length;
  const allGoogleReviews = outletSummaries.flatMap((o) =>
    o.google.reviews.map((r) => ({ ...r, outletName: o.outletName, outletId: o.outletId })),
  );
  allGoogleReviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const allFeedbacks = feedbacks.map((f) => ({
    ...f,
    outletName: (f as { outlet: { name: string } }).outlet.name,
  }));

  // Average rating from all period reviews (not per-outlet average)
  const overallAvgRating = allGoogleReviews.length
    ? allGoogleReviews.reduce((sum, r) => sum + r.rating, 0) / allGoogleReviews.length
    : 0;

  return NextResponse.json({
    period,
    since: since.toISOString(),
    overallAvgRating,
    totalGoogleReviews,
    totalFeedbacks,
    outlets: outletSummaries,
    allGoogleReviews,
    allFeedbacks,
  });
}
