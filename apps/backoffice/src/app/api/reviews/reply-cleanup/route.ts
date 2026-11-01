import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews, replyToReview } from "@/lib/reviews/gbp";
import { mentionsOffer, stripRecoveryOffer } from "@/lib/reviews/reply-offer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/reviews/reply-cleanup[?apply=1] — rewrite every posted Google reply
// that still carries a free-coffee recovery link, replacing that paragraph with
// a neutral contact line (Google review policy). Dry-run by default: lists each
// reply's before/after. Replies that mention an offer in hand-written text are
// reported as "manual" and never auto-edited.
export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) {
    try {
      await requireRole(request.headers, "ADMIN");
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const apply = new URL(request.url).searchParams.get("apply") === "1";

  const outlets = await prisma.outlet.findMany({
    where: {
      status: "ACTIVE",
      reviewSettings: { gbpAccountId: { not: null }, gbpLocationName: { not: null } },
    },
    select: { name: true, reviewSettings: { select: { gbpAccountId: true, gbpLocationName: true } } },
    orderBy: { name: "asc" },
  });

  const results: Array<Record<string, unknown>> = [];
  let scanned = 0;
  let rewritten = 0;

  for (const o of outlets) {
    const account = o.reviewSettings!.gbpAccountId!;
    const location = o.reviewSettings!.gbpLocationName!;
    let pageToken: string | undefined;
    try {
      do {
        const page = await fetchGoogleReviews(account, location, 50, pageToken);
        pageToken = page.nextPageToken;
        for (const r of page.reviews) {
          if (!r.reply) continue;
          scanned++;
          const next = stripRecoveryOffer(r.reply.comment);
          if (next === null) {
            if (mentionsOffer(r.reply.comment)) {
              results.push({ outlet: o.name, reviewId: r.id, reviewer: r.reviewer.name, rating: r.rating, status: "manual", reply: r.reply.comment });
            }
            continue;
          }
          const row = { outlet: o.name, reviewId: r.id, reviewer: r.reviewer.name, rating: r.rating, before: r.reply.comment, after: next };
          if (!apply) {
            results.push({ ...row, status: "would_rewrite" });
            continue;
          }
          try {
            await replyToReview(account, location, r.id, next);
            await prisma.reviewReplyDraft.updateMany({ where: { reviewId: r.id }, data: { finalReply: next } });
            rewritten++;
            results.push({ ...row, status: "rewritten" });
          } catch (e) {
            results.push({ ...row, status: "error", error: (e as Error).message });
          }
        }
      } while (pageToken);
    } catch (e) {
      results.push({ outlet: o.name, status: "error", error: (e as Error).message });
    }
  }

  return NextResponse.json({
    ok: true,
    mode: apply ? "apply" : "dry_run",
    outlets: outlets.length,
    repliesScanned: scanned,
    toRewrite: results.filter((r) => r.status === "would_rewrite" || r.status === "rewritten").length,
    rewritten,
    manual: results.filter((r) => r.status === "manual").length,
    results,
  });
}
