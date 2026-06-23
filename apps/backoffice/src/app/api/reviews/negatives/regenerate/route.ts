import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateReply } from "@/lib/reviews/auto-reply";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/reviews/negatives/regenerate
// Body: { id, context } — recompute a PENDING draft, folding in the approver's
// notes about what actually happened so the reply is honest + specific.
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, context } = await request.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const draft = await prisma.reviewReplyDraft.findUnique({
    where: { id },
    include: { outlet: { select: { name: true } } },
  });
  if (!draft) return NextResponse.json({ error: "Case not found" }, { status: 404 });
  if (draft.status !== "pending") {
    return NextResponse.json({ error: "Can only regenerate before approval" }, { status: 409 });
  }

  const reply = await generateReply({
    rating: draft.rating,
    reviewer: draft.reviewerName ?? "there",
    comment: draft.comment ?? undefined,
    outletName: draft.outlet.name,
    context: typeof context === "string" ? context : undefined,
  });
  if (!reply) {
    return NextResponse.json({ error: "Could not generate a reply" }, { status: 502 });
  }

  await prisma.reviewReplyDraft.update({ where: { id }, data: { draftReply: reply } });
  return NextResponse.json({ id, draftReply: reply });
}
