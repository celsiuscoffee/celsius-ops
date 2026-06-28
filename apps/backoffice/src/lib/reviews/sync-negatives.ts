// Ingest negative Google reviews into ReviewReplyDraft. Extracted verbatim from
// /api/reviews/negatives (the board's sync=1 path) so the review-nudge cron and
// the board use ONE proven code path — instead of negatives only being ingested
// when a human opens the board.
//
// Per GBP-connected outlet: pull recent reviews, create a pending draft for each
// NEW unreplied negative (rating < POSITIVE_THRESHOLD), and resolve any pending
// draft whose review now carries a reply on Google. Best-effort per outlet
// (a failed fetch skips that outlet, never throws). LLM drafting is capped.

import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews } from "@/lib/reviews/gbp";
import { generateReply, POSITIVE_THRESHOLD } from "@/lib/reviews/auto-reply";

// Cap LLM calls per run so a large first-run backlog can't blow up.
const MAX_NEW_DRAFTS_PER_SYNC = 30;

export async function syncNegativeReviewDrafts(): Promise<{ created: number; resolved: number }> {
  let created = 0;
  let resolved = 0;

  const outlets = await prisma.outlet.findMany({ where: { status: "ACTIVE" }, include: { reviewSettings: true } });
  const connected = outlets.filter((o) => o.reviewSettings?.gbpAccountId && o.reviewSettings?.gbpLocationName);

  // Every review we've ever drafted (any status) — so we never double-draft.
  const existing = await prisma.reviewReplyDraft.findMany({ select: { id: true, reviewId: true, status: true } });
  const seenReviewIds = new Set(existing.map((d) => d.reviewId));

  for (const outlet of connected) {
    const settings = outlet.reviewSettings!;
    let reviews;
    try {
      const data = await fetchGoogleReviews(settings.gbpAccountId!, settings.gbpLocationName!, 50);
      reviews = data.reviews;
    } catch (err) {
      console.error(`[reviews/sync-negatives] fetch failed for ${outlet.name}:`, err);
      continue;
    }

    // Resolve pending drafts whose review now carries a reply on Google.
    const repliedIds = reviews.filter((r) => r.reply).map((r) => r.id);
    const toResolve = existing.filter((d) => d.status === "pending" && repliedIds.includes(d.reviewId));
    if (toResolve.length) {
      await prisma.reviewReplyDraft.updateMany({
        where: { id: { in: toResolve.map((d) => d.id) } },
        data: { status: "resolved" },
      });
      resolved += toResolve.length;
    }

    // Draft replies for new unreplied negatives we haven't seen before.
    const newNegatives = reviews.filter((r) => !r.reply && r.rating < POSITIVE_THRESHOLD && !seenReviewIds.has(r.id));
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
        console.error(`[reviews/sync-negatives] draft create failed for ${review.id}:`, err);
      }
    }
  }

  return { created, resolved };
}
