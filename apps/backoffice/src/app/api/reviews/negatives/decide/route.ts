import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { replyToReview } from "@/lib/reviews/gbp";

export const dynamic = "force-dynamic";

// POST /api/reviews/negatives/decide
// Body: { id, action: "approve" | "reject", reply? }
//   - approve: post `reply` (edited) or the stored draft to Google, then mark approved
//   - reject:  mark rejected, nothing is posted
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, action, reply } = await request.json();
  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "id and valid action (approve|reject) required" }, { status: 400 });
  }

  const draft = await prisma.reviewReplyDraft.findUnique({
    where: { id },
    include: { outlet: { include: { reviewSettings: true } } },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  if (draft.status !== "pending") {
    return NextResponse.json({ error: `Already ${draft.status}`, status: draft.status }, { status: 409 });
  }

  const decidedBy = user.name || user.id;

  if (action === "reject") {
    await prisma.reviewReplyDraft.update({
      where: { id },
      data: { status: "rejected", decidedBy, decidedAt: new Date() },
    });
    return NextResponse.json({ id, status: "rejected" });
  }

  // approve → post to GBP, then record the decision
  const settings = draft.outlet.reviewSettings;
  if (!settings?.gbpAccountId || !settings?.gbpLocationName) {
    return NextResponse.json({ error: "GBP not connected for this outlet" }, { status: 400 });
  }
  const finalReply =
    typeof reply === "string" && reply.trim() ? reply.trim() : draft.draftReply;

  try {
    await replyToReview(settings.gbpAccountId, settings.gbpLocationName, draft.reviewId, finalReply);
  } catch (err) {
    console.error(`[reviews/negatives/decide] GBP post failed for ${draft.reviewId}:`, err);
    return NextResponse.json({ error: "Failed to post reply to Google" }, { status: 502 });
  }

  await prisma.reviewReplyDraft.update({
    where: { id },
    data: { status: "approved", finalReply, decidedBy, decidedAt: new Date() },
  });
  return NextResponse.json({ id, status: "approved", posted: true });
}
