import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews } from "@/lib/reviews/gbp";
import { generateReply, POSITIVE_THRESHOLD } from "@/lib/reviews/auto-reply";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Cap LLM calls per sync so a large first-run backlog can't blow up.
const MAX_NEW_DRAFTS_PER_SYNC = 30;

// GET /api/reviews/negatives[?sync=1]
// Returns the pending negative-review approval queue.
// With sync=1, first pulls Google reviews and:
//   - drafts a reply for each new unreplied NEGATIVE (1-3★) review, and
//   - marks any pending draft whose review now has a reply as "resolved"
//     (it was handled elsewhere — e.g. a manual reply).
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sync = new URL(request.url).searchParams.get("sync") === "1";
  let created = 0;
  let resolved = 0;

  if (sync) {
    const outlets = await prisma.outlet.findMany({
      where: { status: "ACTIVE" },
      include: { reviewSettings: true },
    });
    const connected = outlets.filter(
      (o) => o.reviewSettings?.gbpAccountId && o.reviewSettings?.gbpLocationName,
    );

    // Every review we've ever drafted (any status) — so we never double-draft.
    const existing = await prisma.reviewReplyDraft.findMany({
      select: { id: true, reviewId: true, status: true },
    });
    const seenReviewIds = new Set(existing.map((d) => d.reviewId));

    for (const outlet of connected) {
      const settings = outlet.reviewSettings!;
      let reviews;
      try {
        const data = await fetchGoogleReviews(
          settings.gbpAccountId!,
          settings.gbpLocationName!,
          50,
        );
        reviews = data.reviews;
      } catch (err) {
        console.error(`[reviews/negatives] sync fetch failed for ${outlet.name}:`, err);
        continue;
      }

      // Resolve pending drafts whose review now carries a reply on Google.
      const repliedIds = reviews.filter((r) => r.reply).map((r) => r.id);
      const toResolve = existing.filter(
        (d) => d.status === "pending" && repliedIds.includes(d.reviewId),
      );
      if (toResolve.length) {
        await prisma.reviewReplyDraft.updateMany({
          where: { id: { in: toResolve.map((d) => d.id) } },
          data: { status: "resolved" },
        });
        resolved += toResolve.length;
      }

      // Draft replies for new unreplied negatives we haven't seen before.
      const newNegatives = reviews.filter(
        (r) => !r.reply && r.rating < POSITIVE_THRESHOLD && !seenReviewIds.has(r.id),
      );
      for (const review of newNegatives) {
        if (created >= MAX_NEW_DRAFTS_PER_SYNC) break;
        try {
          const draft = await generateReply({
            rating: review.rating,
            reviewer: review.reviewer.name,
            comment: review.comment,
            outletName: outlet.name,
          });
          if (!draft) continue;
          await prisma.reviewReplyDraft.create({
            data: {
              reviewId: review.id,
              outletId: outlet.id,
              reviewerName: review.reviewer.name,
              rating: review.rating,
              comment: review.comment ?? null,
              draftReply: draft,
            },
          });
          seenReviewIds.add(review.id);
          created++;
        } catch (err) {
          console.error(`[reviews/negatives] draft create failed for ${review.id}:`, err);
        }
      }
    }
  }

  const pending = await prisma.reviewReplyDraft.findMany({
    where: { status: "pending" },
    include: { outlet: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    synced: sync,
    created,
    resolved,
    pending: pending.map((d) => ({
      id: d.id,
      reviewId: d.reviewId,
      outletId: d.outletId,
      outletName: d.outlet.name,
      reviewerName: d.reviewerName,
      rating: d.rating,
      comment: d.comment,
      draftReply: d.draftReply,
      createdAt: d.createdAt,
    })),
  });
}
