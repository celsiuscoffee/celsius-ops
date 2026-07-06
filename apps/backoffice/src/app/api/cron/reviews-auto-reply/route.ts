import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews, replyToReview } from "@/lib/reviews/gbp";
import { generateReply, extractImprovement, POSITIVE_THRESHOLD } from "@/lib/reviews/auto-reply";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// While we reply to each happy (4-5★) review, also catch any fixable point
// buried in the praise and flag it for the ops review-nudge (WhatsApp). Default
// on; set REVIEWS_IMPROVEMENT_FLAGS_ENABLED=false to pause without a deploy.
const IMPROVEMENT_FLAGS_ENABLED =
  (process.env.REVIEWS_IMPROVEMENT_FLAGS_ENABLED || "true").toLowerCase() !== "false";

// Scheduled auto-reply for POSITIVE (4-5★) Google reviews only.
//
// Negative reviews (1-3★) are intentionally NOT touched here — they are
// never generated or posted. They stay on the human-approval path until
// the risk-classifier work lands (see
// docs/design/reviews-reply-recovery-loop.md). This is the zero-risk wedge.
//
// Idempotent: reviews that already carry a reply (from a prior run or a
// manual reply) are skipped, so re-running never double-posts.
//
// Per-outlet budget so a high-volume outlet (e.g. Putrajaya) can't consume the
// whole run and starve the others — that left Shah Alam/Tamarind/Nilai at ~0%
// response rate under the old single global cap.
const MAX_PER_OUTLET = 25; // fair share per outlet per run
const MAX_TOTAL = 120; // global safety ceiling across all outlets per run

type OutletResult = {
  outletId: string;
  outletName: string;
  candidates: number;
  posted: number;
  failed: number;
  flagged: number; // happy reviews with a fixable point, surfaced to ops
  error?: string;
};

async function runReviewsAutoReply() {
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    include: { reviewSettings: true },
  });

  const connected = outlets.filter(
    (o) => o.reviewSettings?.gbpAccountId && o.reviewSettings?.gbpLocationName,
  );

  const results: OutletResult[] = [];
  let totalPosted = 0;
  let totalFailed = 0;
  let totalFlagged = 0;

  for (const outlet of connected) {
    if (totalPosted >= MAX_TOTAL) break;
    const settings = outlet.reviewSettings!;

    try {
      const data = await fetchGoogleReviews(
        settings.gbpAccountId!,
        settings.gbpLocationName!,
        50,
      );

      // Positive AND not yet replied. Negatives are excluded before we ever
      // call the LLM, so this path can never post to a 1-3★ review.
      const candidates = data.reviews.filter(
        (r) => !r.reply && r.rating >= POSITIVE_THRESHOLD,
      );

      let posted = 0;
      let failed = 0;
      let flagged = 0;

      for (const review of candidates) {
        if (posted >= MAX_PER_OUTLET || totalPosted + posted >= MAX_TOTAL) break;
        try {
          const reply = await generateReply({
            rating: review.rating,
            reviewer: review.reviewer.name,
            comment: review.comment,
            outletName: outlet.name,
          });
          if (!reply) {
            failed++;
            continue;
          }
          await replyToReview(
            settings.gbpAccountId!,
            settings.gbpLocationName!,
            review.id,
            reply,
          );
          posted++;

          // Happy-but-fixable: read the praise for a concrete point and flag it
          // for the ops review-nudge. Isolated — a classifier slip never fails
          // the reply we just posted. Skip comment-less ratings (nothing to read).
          if (IMPROVEMENT_FLAGS_ENABLED && review.comment?.trim()) {
            try {
              const verdict = await extractImprovement({
                rating: review.rating,
                comment: review.comment,
                outletName: outlet.name,
              });
              if (verdict.actionable) {
                await prisma.reviewImprovementFlag.upsert({
                  where: { reviewId: review.id },
                  create: {
                    reviewId: review.id,
                    outletId: outlet.id,
                    reviewerName: review.reviewer.name,
                    rating: review.rating,
                    comment: review.comment,
                    point: verdict.point,
                  },
                  update: { point: verdict.point },
                });
                flagged++;
              }
            } catch (cErr) {
              console.error(
                `[reviews-auto-reply] improvement-flag failed for review ${review.id} (${outlet.name}):`,
                cErr,
              );
            }
          }
        } catch (err) {
          console.error(
            `[reviews-auto-reply] failed for review ${review.id} (${outlet.name}):`,
            err,
          );
          failed++;
        }
      }

      totalPosted += posted;
      totalFailed += failed;
      totalFlagged += flagged;
      results.push({
        outletId: outlet.id,
        outletName: outlet.name,
        candidates: candidates.length,
        posted,
        failed,
        flagged,
      });
    } catch (err) {
      console.error(
        `[reviews-auto-reply] fetch failed for outlet ${outlet.name}:`,
        err,
      );
      results.push({
        outletId: outlet.id,
        outletName: outlet.name,
        candidates: 0,
        posted: 0,
        failed: 0,
        flagged: 0,
        error: "fetch_failed",
      });
    }
  }

  return NextResponse.json({
    ran_at: new Date().toISOString(),
    outlets_connected: connected.length,
    max_per_outlet: MAX_PER_OUTLET,
    total_posted: totalPosted,
    total_failed: totalFailed,
    total_flagged: totalFlagged,
    results,
  });
}

const cronHandler = cronRoute("reviews-auto-reply", runReviewsAutoReply);

// Cron secret (via cronRoute) OR an authenticated admin (so it can be
// triggered manually).
export async function GET(req: NextRequest) {
  const user = await getUserFromHeaders(req.headers);
  if (user) return runReviewsAutoReply();
  return cronHandler(req);
}
