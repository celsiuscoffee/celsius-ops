import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { tryApplyHumanApproval } from "@/lib/inventory/agents/human-approval";

// Human-takeover send (#9). Staff reply to a supplier from the inbox. Free-text
// is only allowed inside the 24h customer-service window (supplier messaged us in
// the last 24h); outside it Meta requires an approved template, so we refuse with
// a clear 409 rather than silently failing.

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key } = await params; // supplier counterparty number (digits)
  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  // Optional quoted-reply: the Meta message id of the inbound message being
  // replied to. The UI passes the WhatsApp `waMessageId` directly; if a caller
  // only has our DB row id, resolve it to the Meta id server-side.
  const replyToRaw = typeof body.replyTo === "string" ? body.replyTo.trim() : "";
  let replyTo = "";
  if (replyToRaw) {
    if (replyToRaw.startsWith("wamid.")) {
      replyTo = replyToRaw;
    } else {
      const ref = await prisma.whatsAppMessage.findUnique({
        where: { id: replyToRaw },
        select: { waMessageId: true },
      });
      replyTo = ref?.waMessageId ?? "";
    }
  }

  // 24h window: did this counterparty message us within the last 24h?
  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where: { fromNumber: key, direction: "inbound" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  const windowOpen =
    !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < 24 * 60 * 60 * 1000;
  if (!windowOpen) {
    return NextResponse.json(
      { error: "The 24-hour reply window is closed. Free text can't be sent — use an approved template." },
      { status: 409 },
    );
  }

  const result = await sendWhatsAppText(key, text, replyTo || undefined);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 502 });
  }

  // Resolve our own business number + supplier link from a recent message so the
  // outbound row threads correctly (inbound.toNumber / outbound.fromNumber = us).
  const ref = await prisma.whatsAppMessage.findFirst({
    where: { OR: [{ fromNumber: key }, { toNumber: key }] },
    orderBy: { timestamp: "desc" },
    select: { direction: true, fromNumber: true, toNumber: true, supplierId: true },
  });
  const ourNumber = ref ? (ref.direction === "inbound" ? ref.toNumber : ref.fromNumber) : "";

  await recordOutboundMessage({
    waMessageId: result.messageId,
    fromNumber: ourNumber,
    toNumber: key,
    type: "text",
    body: text,
    supplierId: ref?.supplierId ?? null,
    status: "sent",
  });

  // If this reply is an affirmative ("boleh") and the agent has a held proposal on the
  // thread, apply it now — so approving in chat actually moves the PO (closes the loop).
  const approval = await tryApplyHumanApproval(key, text, caller.id);

  return NextResponse.json({ ok: true, messageId: result.messageId, approval });
}
