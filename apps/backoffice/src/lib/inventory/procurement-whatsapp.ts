/**
 * Procurement WhatsApp senders — Proof of Payment (POP), and later the PO.
 *
 * These are business-initiated messages to SUPPLIERS, so they go out as
 * approved Meta utility templates (see docs/design/whatsapp-procurement-loop.md),
 * not free-form text. Transport is the generic helper in lib/whatsapp.ts.
 *
 * Gated behind PROCUREMENT_WHATSAPP_ENABLED so auto-sends to real suppliers only
 * begin once the templates are approved and the team is ready — flipping that
 * env flag to "true" is the go-live switch. Off by default.
 */
import { prisma } from "@/lib/prisma";
import { sendWhatsAppTemplate, isWhatsAppConfigured } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

const POP_TEMPLATE = "proof_of_payment";

export function isProcurementWhatsAppEnabled(): boolean {
  return process.env.PROCUREMENT_WHATSAPP_ENABLED === "true" && isWhatsAppConfigured();
}

export interface ProcurementSendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

/**
 * Send the Proof of Payment (receipt PDF + summary) to the supplier for a fully
 * PAID invoice, then stamp popSentAt. Idempotent and defensive: no-ops if the
 * feature is off, the POP was already sent, the supplier has no phone, or there
 * is no receipt document. NEVER throws — a messaging failure must not fail the
 * payment write that triggered it; the caller just logs the result.
 */
export async function sendProofOfPayment(invoiceId: string): Promise<ProcurementSendResult> {
  if (!isProcurementWhatsAppEnabled()) return { sent: false, reason: "disabled" };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      invoiceNumber: true,
      amount: true,
      paymentRef: true,
      paidVia: true,
      popSentAt: true,
      photos: true,
      supplier: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!invoice) return { sent: false, reason: "invoice-not-found" };
  if (invoice.popSentAt) return { sent: false, reason: "already-sent" };

  const phone = invoice.supplier?.phone?.trim();
  if (!phone) return { sent: false, reason: "no-supplier-phone" };

  // DIRECT public URL of the real payment RECEIPT — WhatsApp fetches it for the document
  // header, so it must be the real file URL (never the popShortLink redirect, which the
  // media fetcher won't follow). Only ever send a document stored under the `/pop/` path
  // (file-naming.popStoragePath); an invoice image or any other attachment must NEVER go
  // out as "proof of payment". If the invoice was marked paid with no receipt on file,
  // there's nothing legitimate to send — skip WITHOUT stamping popSentAt, so the real
  // receipt can still go out once it's uploaded.
  const popUrl = (invoice.photos ?? []).filter((p) => p.includes("/pop/")).pop();
  if (!popUrl) return { sent: false, reason: "no-pop-document" };

  const amount = `RM ${Number(invoice.amount).toFixed(2)}`;
  const ref = invoice.paymentRef?.trim() || invoice.paidVia?.trim() || "—";

  const result = await sendWhatsAppTemplate(phone, POP_TEMPLATE, "en", [
    {
      type: "header",
      parameters: [
        {
          type: "document",
          document: { link: popUrl, filename: `POP-${invoice.invoiceNumber}.pdf` },
        },
      ],
    },
    {
      type: "body",
      parameters: [
        { type: "text", text: invoice.supplier?.name || "there" },
        { type: "text", text: invoice.invoiceNumber },
        { type: "text", text: amount },
        { type: "text", text: ref },
      ],
    },
  ]);

  // Record the send in the supplier thread so the POP shows in the chat (like the PO send), and so
  // its waMessageId can later carry the delivery status. Best-effort — never blocks the send/result.
  const supplierId = invoice.supplier?.id ?? null;
  try {
    const lastMsg = supplierId
      ? await prisma.whatsAppMessage.findFirst({
          where: { supplierId },
          orderBy: { timestamp: "desc" },
          select: { direction: true, fromNumber: true, toNumber: true },
        })
      : null;
    const ourNumber = lastMsg ? (lastMsg.direction === "inbound" ? lastMsg.toNumber : lastMsg.fromNumber) : "";
    await recordOutboundMessage({
      waMessageId: result.messageId,
      fromNumber: ourNumber,
      toNumber: phone,
      type: "document",
      body: `🧾 Proof of payment sent — ${invoice.invoiceNumber}, ${amount} (ref ${ref})`,
      mediaUrl: popUrl,
      supplierId,
      status: result.ok ? "sent" : "failed",
      raw: { kind: "pop_send", invoiceId, ok: result.ok, sendFailed: !result.ok, error: result.error ?? null },
    });
  } catch (e) {
    console.warn(`[procurement:pop] record-message failed invoice=${invoiceId}: ${e instanceof Error ? e.message : e}`);
  }

  if (!result.ok) {
    console.warn(`[procurement:pop] send failed invoice=${invoiceId} err=${result.error}`);
    return { sent: false, reason: result.error };
  }

  await prisma.invoice.update({ where: { id: invoiceId }, data: { popSentAt: new Date() } });
  console.log(`[procurement:pop] sent invoice=${invoiceId} to=${phone} msg=${result.messageId}`);
  return { sent: true, messageId: result.messageId };
}
