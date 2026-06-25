import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

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

  const result = await sendWhatsAppText(key, text);
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

  return NextResponse.json({ ok: true, messageId: result.messageId });
}
