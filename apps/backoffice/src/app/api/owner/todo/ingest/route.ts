import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { captureFromMessages } from "@/lib/owner-todo/capture";
import { getOwnerUser } from "@/lib/owner-todo/board";

// POST /api/owner/todo/ingest — headless capture feed from the owner's Mac
// (apps/backoffice/scripts/owner-todo-scanner.mjs, launchd). Bearer
// OWNER_TODO_INGEST_SECRET, falling back to FINANCE_INGEST_SECRET so the
// existing watcher credential works on day one. The body is raw chat windows;
// the model extraction and mode gating happen server-side so the Mac script
// stays dumb and the cost + outcome land on the agent ledger.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Message = z.object({
  id: z.string().min(1).max(40),
  ts: z.string().min(10).max(40),
  fromMe: z.boolean(),
  sender: z.string().max(120),
  text: z.string().max(4000),
  replyTo: z.string().max(600).nullish(),
  isNew: z.boolean(),
});
const Chat = z.object({
  chatId: z.string().min(1).max(120),
  chatName: z.string().max(200),
  isGroup: z.boolean(),
  messages: z.array(Message).max(400),
});
const Body = z.object({
  source: z.enum(["whatsapp", "telegram", "email", "notes", "sheet"]),
  chats: z.array(Chat).max(200),
});

function secretOk(req: NextRequest): boolean {
  const expected = process.env.OWNER_TODO_INGEST_SECRET || process.env.FINANCE_INGEST_SECRET;
  if (!expected) return false;
  const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad request", detail: String(e).slice(0, 300) }, { status: 400 });
  }

  const owner = await getOwnerUser();
  if (!owner) return NextResponse.json({ error: "no active OWNER user" }, { status: 409 });

  const result = await captureFromMessages({
    source: body.source,
    ownerUserId: owner.id,
    ownerName: owner.name,
    chats: body.chats,
  });
  return NextResponse.json(result);
}
