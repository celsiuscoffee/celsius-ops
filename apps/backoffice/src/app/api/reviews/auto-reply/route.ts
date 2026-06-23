import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews, replyToReview } from "@/lib/reviews/gbp";
import { generateReply } from "@/lib/reviews/auto-reply";

// POST /api/reviews/auto-reply
// Body: { outletId, reviewId, mode: "preview" | "post", batch: true }
// - outletId: single outlet | omit with batch:true for all outlets
// - preview: generate reply without posting
// - post: generate and post to GBP
// - batch: true = process all connected outlets
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { outletId, reviewId, mode = "preview", batch } = await request.json();

  // Batch mode: process all connected outlets
  if (batch) {
    const outlets = await prisma.outlet.findMany({
      where: { status: "ACTIVE" },
      include: { reviewSettings: true },
    });

    const connectedOutlets = outlets.filter(
      (o) => o.reviewSettings?.gbpAccountId && o.reviewSettings?.gbpLocationName,
    );

    const outletResults = [];
    let totalPosted = 0;
    let totalPending = 0;

    for (const outlet of connectedOutlets) {
      const settings = outlet.reviewSettings!;
      try {
        const data = await fetchGoogleReviews(settings.gbpAccountId!, settings.gbpLocationName!, 50);
        const unreplied = data.reviews.filter((r) => !r.reply);

        const results = [];
        for (const review of unreplied) {
          try {
            const isPositive = review.rating >= 4;
            const reply = await generateReply({
              rating: review.rating,
              reviewer: review.reviewer.name,
              comment: review.comment,
              outletName: outlet.name,
            });

            const shouldPost = isPositive && mode === "post";
            if (shouldPost) {
              await replyToReview(settings.gbpAccountId!, settings.gbpLocationName!, review.id, reply);
              totalPosted++;
            } else if (!isPositive) {
              totalPending++;
            }

            results.push({
              reviewId: review.id,
              reviewer: review.reviewer.name,
              rating: review.rating,
              comment: review.comment,
              reply,
              posted: shouldPost,
              needsApproval: !isPositive,
            });
          } catch (err) {
            console.error(`Auto-reply failed for review ${review.id}:`, err);
            results.push({
              reviewId: review.id,
              reviewer: review.reviewer.name,
              rating: review.rating,
              comment: review.comment,
              error: "Failed",
              posted: false,
              needsApproval: false,
            });
          }
        }

        outletResults.push({
          outletId: outlet.id,
          outletName: outlet.name,
          total: unreplied.length,
          results,
        });
      } catch (err) {
        console.error(`Batch auto-reply failed for outlet ${outlet.name}:`, err);
        outletResults.push({
          outletId: outlet.id,
          outletName: outlet.name,
          total: 0,
          results: [],
          error: "Failed to fetch reviews",
        });
      }
    }

    return NextResponse.json({
      batch: true,
      outlets: outletResults,
      totalPosted,
      totalPending,
      totalOutlets: connectedOutlets.length,
    });
  }

  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const settings = await prisma.reviewSettings.findUnique({
    where: { outletId },
    include: { outlet: { select: { name: true } } },
  });
  if (!settings?.gbpAccountId || !settings?.gbpLocationName) {
    return NextResponse.json({ error: "GBP not connected" }, { status: 400 });
  }

  const outletName = settings.outlet.name;

  // If reviewId provided, reply to single review
  if (reviewId) {
    const data = await fetchGoogleReviews(settings.gbpAccountId, settings.gbpLocationName, 50);
    const review = data.reviews.find((r) => r.id === reviewId);
    if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
    if (review.reply) return NextResponse.json({ error: "Already replied", skipped: true });

    const reply = await generateReply({
      rating: review.rating,
      reviewer: review.reviewer.name,
      comment: review.comment,
      outletName,
    });

    if (mode === "post") {
      await replyToReview(settings.gbpAccountId, settings.gbpLocationName, reviewId, reply);
    }

    return NextResponse.json({ reviewId, reply, posted: mode === "post" });
  }

  // No reviewId = batch auto-reply all unreplied reviews
  // Good reviews (4-5 stars): auto-post immediately
  // Bad reviews (1-3 stars): generate draft for approval only
  const data = await fetchGoogleReviews(settings.gbpAccountId, settings.gbpLocationName, 50);
  const unreplied = data.reviews.filter((r) => !r.reply);

  if (unreplied.length === 0) {
    return NextResponse.json({ message: "All reviews already replied", results: [], posted: 0, pending: 0 });
  }

  const results = [];
  let postedCount = 0;
  let pendingCount = 0;

  for (const review of unreplied) {
    try {
      const isPositive = review.rating >= 4; // 4-5 = good (auto-post), 1-3 = bad (approval)
      const reply = await generateReply({
        rating: review.rating,
        reviewer: review.reviewer.name,
        comment: review.comment,
        outletName,
      });

      // Good reviews: auto-post. Bad reviews: draft only (needs approval).
      const shouldPost = isPositive && mode === "post";
      if (shouldPost) {
        await replyToReview(settings.gbpAccountId, settings.gbpLocationName, review.id, reply);
        postedCount++;
      } else if (!isPositive) {
        pendingCount++;
      }

      results.push({
        reviewId: review.id,
        reviewer: review.reviewer.name,
        rating: review.rating,
        comment: review.comment,
        reply,
        posted: shouldPost,
        needsApproval: !isPositive,
      });
    } catch (err) {
      console.error(`Auto-reply failed for review ${review.id}:`, err);
      results.push({
        reviewId: review.id,
        reviewer: review.reviewer.name,
        rating: review.rating,
        comment: review.comment,
        error: "Failed to generate/post reply",
        posted: false,
        needsApproval: false,
      });
    }
  }

  return NextResponse.json({ total: unreplied.length, posted: postedCount, pending: pendingCount, results });
}
