import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { moveCard, rejectCard, editCard, snoozeCardToTomorrow, isStage } from "@/lib/owner-todo/board";

export const dynamic = "force-dynamic";

const PatchBody = z.object({
  // Exactly one of these per call keeps the semantics obvious on the client.
  stage: z.string().optional(),
  action: z.enum(["reject", "tomorrow"]).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (body.action === "reject") {
    const ok = await rejectCard(id, session.id, "board");
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (body.action === "tomorrow") {
    const card = await snoozeCardToTomorrow(id, session.id);
    return card ? NextResponse.json({ card }) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (body.stage !== undefined) {
    if (!isStage(body.stage) || body.stage === "triage") return NextResponse.json({ error: "bad stage" }, { status: 400 });
    const card = await moveCard(id, session.id, body.stage, "board");
    return card ? NextResponse.json({ card }) : NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const card = await editCard(id, session.id, {
    title: body.title,
    notes: body.notes,
    dueAt: body.dueAt === undefined ? undefined : body.dueAt ? new Date(body.dueAt) : null,
  });
  return card ? NextResponse.json({ card }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
