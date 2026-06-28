import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import {
  ackRecipient,
  getInstruction,
  getInstructionAuthor,
  nudgePendingRecipients,
} from "@/lib/ops-instructions";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// GET — full instruction with per-recipient delivery + ack status.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const detail = await getInstruction(id, { userId: session.id, role: session.role });
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}

const schema = z.object({
  action: z.enum(["nudge", "ack"]),
  recipientId: z.string().optional(),
});

// POST — nudge the recipients who haven't acked, or mark one recipient acked
// manually (owner confirmed verbally). Non-admins may only act on instructions
// they authored.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const author = await getInstructionAuthor(id);
  if (!author) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && author.createdByUserId !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.action === "ack") {
    if (!body.recipientId) return NextResponse.json({ error: "recipientId required" }, { status: 400 });
    await ackRecipient(body.recipientId);
    return NextResponse.json({ ok: true });
  }

  const res = await nudgePendingRecipients(id);
  return NextResponse.json({ ok: true, ...res });
}
