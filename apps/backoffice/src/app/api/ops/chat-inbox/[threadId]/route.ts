import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getThread, isWindowOpen } from "@/lib/wa-messages";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { isWhatsAppConfigured, sendWhatsAppText } from "@/lib/whatsapp";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// threadId is the staff phone (canonical "60…"); getThread re-canonicalises so
// any phone format in the URL resolves to the same thread.

// GET — full message history for one conversation + 24h-window + alert context.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { threadId } = await params;
  const thread = await getThread(decodeURIComponent(threadId), new Date());
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(thread);
}

const sendSchema = z.object({ text: z.string().trim().min(1).max(4000) });

// POST — send a free-form reply. Only valid inside the recipient's open 24h
// window (WhatsApp policy); outside it we refuse with a clear 409 rather than
// silently failing at Meta.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ error: "WhatsApp not configured" }, { status: 503 });
  }

  const { threadId } = await params;
  const phone = decodeURIComponent(threadId);

  let body: { text: string };
  try {
    body = sendSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const now = new Date();
  if (!(await isWindowOpen(phone, now))) {
    return NextResponse.json(
      {
        error: "outside_window",
        message:
          "Outside the 24-hour reply window. WhatsApp only allows free-form replies within 24h of the recipient's last message — they'll need to message the bot again (or you send an approved template) before a reply can be delivered.",
      },
      { status: 409 },
    );
  }

  const result = await sendWhatsAppText(phone, body.text);
  await recordOutboundMessage({
    waMessageId: result.messageId,
    fromNumber: process.env.WHATSAPP_DISPLAY_NUMBER || "",
    toNumber: phone,
    type: "text",
    body: body.text,
    status: result.ok ? "sent" : "failed",
  });

  if (!result.ok) {
    return NextResponse.json({ error: "send_failed", message: result.error || "Send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, messageId: result.messageId });
}
