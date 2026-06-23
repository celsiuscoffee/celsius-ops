import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { replyToReview } from "@/lib/reviews/gbp";
import { genRecoveryCode, compensateReviewCase } from "@/lib/reviews/recovery";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://backoffice.celsiuscoffee.com";

// POST /api/reviews/negatives/decide
// Body: { id, action, reply?, phone?, name?, note? }
//   approve     — post reply (+ recovery code CTA) to GBP, status → approved
//   reject      — status → rejected, nothing posted
//   compensate  — manager has the customer's phone offline: capture + voucher
//   resolve     — close the case as made-whole
//   expire      — recovery code went unclaimed; close as unrecovered
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, action, reply, phone, name, note } = await request.json();
  const VALID = ["approve", "reject", "compensate", "resolve", "expire"];
  if (!id || !VALID.includes(action)) {
    return NextResponse.json({ error: "id and valid action required" }, { status: 400 });
  }

  const draft = await prisma.reviewReplyDraft.findUnique({
    where: { id },
    include: { outlet: { include: { reviewSettings: true } } },
  });
  if (!draft) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  const decidedBy = user.name || user.id;
  const now = new Date();

  // ── approve / reject: only from the NEW (pending) state ──────────────────
  if (action === "reject") {
    if (draft.status !== "pending") {
      return NextResponse.json({ error: `Already ${draft.status}` }, { status: 409 });
    }
    await prisma.reviewReplyDraft.update({
      where: { id },
      data: { status: "rejected", decidedBy, decidedAt: now },
    });
    return NextResponse.json({ id, status: "rejected" });
  }

  if (action === "approve") {
    if (draft.status !== "pending") {
      return NextResponse.json({ error: `Already ${draft.status}` }, { status: 409 });
    }
    const settings = draft.outlet.reviewSettings;
    if (!settings?.gbpAccountId || !settings?.gbpLocationName) {
      return NextResponse.json({ error: "GBP not connected for this outlet" }, { status: 400 });
    }
    const base = typeof reply === "string" && reply.trim() ? reply.trim() : draft.draftReply;
    const code = genRecoveryCode();
    // Deterministic recovery CTA — the link/code are appended in code, never by
    // the LLM, so they can't be mangled. Google replies are plain text.
    const finalReply = `${base}\n\nWe'd like to make this right. Please visit ${APP_URL}/recover/${code} so we can reach you personally.`;

    try {
      await replyToReview(settings.gbpAccountId, settings.gbpLocationName, draft.reviewId, finalReply);
    } catch (err) {
      console.error(`[decide] GBP post failed for ${draft.reviewId}:`, err);
      return NextResponse.json({ error: "Failed to post reply to Google" }, { status: 502 });
    }

    await prisma.reviewReplyDraft.update({
      where: { id },
      data: {
        status: "approved",
        finalReply,
        recoveryCode: code,
        recoveryCodeAt: now,
        decidedBy,
        decidedAt: now,
      },
    });
    return NextResponse.json({ id, status: "approved", posted: true, recoveryCode: code });
  }

  // ── compensate: manager captured the phone offline ──────────────────────
  if (action === "compensate") {
    if (typeof phone !== "string" || !phone.trim()) {
      return NextResponse.json({ error: "phone required" }, { status: 400 });
    }
    const result = await compensateReviewCase(id, phone, typeof name === "string" ? name : null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ id, status: "compensated", ...result });
  }

  // ── resolve / expire: close the case ────────────────────────────────────
  if (action === "resolve") {
    if (!["approved", "compensated"].includes(draft.status)) {
      return NextResponse.json({ error: `Cannot resolve a ${draft.status} case` }, { status: 409 });
    }
    await prisma.reviewReplyDraft.update({
      where: { id },
      data: { status: "resolved", resolvedAt: now, resolvedBy: decidedBy, resolutionNote: note ?? null },
    });
    return NextResponse.json({ id, status: "resolved" });
  }

  // expire
  if (draft.status !== "approved") {
    return NextResponse.json({ error: `Cannot expire a ${draft.status} case` }, { status: 409 });
  }
  await prisma.reviewReplyDraft.update({
    where: { id },
    data: { status: "expired", resolvedAt: now, resolvedBy: decidedBy, resolutionNote: note ?? null },
  });
  return NextResponse.json({ id, status: "expired" });
}
