import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncNegativeReviewDrafts } from "@/lib/reviews/sync-negatives";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    // Same proven path the review-nudge cron uses (lib/reviews/sync-negatives).
    const r = await syncNegativeReviewDrafts();
    created = r.created;
    resolved = r.resolved;
  }

  // scope=all → the full case board (every status). Default → pending only,
  // which keeps the existing "Needs approval" tab working unchanged.
  const scopeAll = new URL(request.url).searchParams.get("scope") === "all";

  const rows = await prisma.reviewReplyDraft.findMany({
    where: scopeAll ? {} : { status: "pending" },
    include: { outlet: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  type CaseRow = {
    id: string;
    source: "google" | "qr";
    reviewId: string;
    outletId: string;
    outletName: string;
    reviewerName: string | null;
    phone: string | null;
    rating: number;
    comment: string | null;
    draftReply: string;
    finalReply: string | null;
    status: string;
    recoveryCode: string | null;
    claimedAt: Date | null;
    recoveryMemberId: string | null;
    recoveryRewardId: string | null;
    redeemedAt: Date | null;
    resolvedAt: Date | null;
    decidedBy: string | null;
    createdAt: Date;
  };

  const googleCases: CaseRow[] = rows.map((d) => ({
    id: d.id,
    source: "google",
    reviewId: d.reviewId,
    outletId: d.outletId,
    outletName: d.outlet.name,
    reviewerName: d.reviewerName,
    phone: null,
    rating: d.rating,
    comment: d.comment,
    draftReply: d.draftReply,
    finalReply: d.finalReply,
    status: d.status,
    recoveryCode: d.recoveryCode,
    claimedAt: d.claimedAt,
    recoveryMemberId: d.recoveryMemberId,
    recoveryRewardId: d.recoveryRewardId,
    redeemedAt: d.redeemedAt,
    resolvedAt: d.resolvedAt,
    decidedBy: d.decidedBy,
    createdAt: d.createdAt,
  }));

  // QR feedback (1-3★) folds into the same board on scope=all. It already has
  // the customer's phone, so it skips the reply + recovery-code steps.
  let qrCases: CaseRow[] = [];
  if (scopeAll) {
    const fb = await prisma.internalFeedback.findMany({
      where: { rating: { lte: 3 } },
      include: { outlet: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    qrCases = fb.map((f) => ({
      id: f.id,
      source: "qr",
      reviewId: f.id,
      outletId: f.outletId,
      outletName: f.outlet.name,
      reviewerName: f.name,
      phone: f.phone,
      rating: f.rating,
      comment: f.feedback,
      draftReply: "",
      finalReply: null,
      status: f.status,
      recoveryCode: null,
      claimedAt: f.compensatedAt,
      recoveryMemberId: f.recoveryMemberId,
      recoveryRewardId: f.recoveryRewardId,
      redeemedAt: null,
      resolvedAt: f.resolvedAt,
      decidedBy: f.resolvedBy,
      createdAt: f.createdAt,
    }));
  }

  const cases = [...googleCases, ...qrCases].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  const pending = googleCases.filter((c) => c.status === "pending");

  return NextResponse.json({ synced: sync, created, resolved, pending, cases });
}
