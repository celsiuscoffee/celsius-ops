import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { listBoard, createCard, captureStats, isStage } from "@/lib/owner-todo/board";

// The owner's personal board. OWNER only: this is his private to-do list,
// not a workspace surface, and the capture feed is his own chats.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [cards, stats] = await Promise.all([listBoard(session.id), captureStats(14)]);
  return NextResponse.json({ cards, stats });
}

const CreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).nullish(),
  dueAt: z.string().datetime().nullish(),
  stage: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const card = await createCard(session.id, {
    title: body.title,
    notes: body.notes ?? null,
    dueAt: body.dueAt ? new Date(body.dueAt) : null,
    stage: isStage(body.stage) ? body.stage : "todo",
  });
  return NextResponse.json({ card }, { status: 201 });
}
