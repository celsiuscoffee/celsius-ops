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
      supplier: { select: { name: true, phone: true } },
    },
  });
  if (!invoice) return { sent: false, reason: "invoice-not-found" };
  if (invoice.popSentAt) return { sent: false, reason: "already-sent" };

  const phone = invoice.supplier?.phone?.trim();
  if (!phone) return { sent: false, reason: "no-supplier-phone" };

  // DIRECT public URL of the receipt (the last POP photo) — WhatsApp fetches
  // this for the document header, so it must be the real file URL, never the
  // popShortLink redirect (the media fetcher won't follow it).
  const popUrl = invoice.photos?.[invoice.photos.length - 1];
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

  if (!result.ok) {
    console.warn(`[procurement:pop] send failed invoice=${invoiceId} err=${result.error}`);
    return { sent: false, reason: result.error };
  }

  await prisma.invoice.update({ where: { id: invoiceId }, data: { popSentAt: new Date() } });
  console.log(`[procurement:pop] sent invoice=${invoiceId} to=${phone} msg=${result.messageId}`);
  return { sent: true, messageId: result.messageId };
}
