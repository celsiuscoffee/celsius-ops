import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { detectPaymentFlags, mergeFlags } from "@/lib/inventory/flag-detector";
import { sendProofOfPayment } from "@/lib/inventory/procurement-whatsapp";

// Only an OPEN invoice may be paid — never re-stamp a PAID one, never a DRAFT/provisional.
const PAYABLE = ["PENDING", "INITIATED", "OVERDUE"] as const;

/**
 * Mark an invoice fully PAID from a proof-of-payment — ATOMICALLY (only if still open), attach
 * the POP receipt (to the invoice + its order), run the duplicate-payment flag detector, and
 * send the POP to the supplier. Shared so the Telegram POP resolver and the BackOffice "confirm
 * possible POP" action do the identical money-write. The messaging/flag side effects are
 * best-effort and never throw — a failure there must not fail the payment write.
 *
 * Returns { ok:false, alreadyPaid:true } when the invoice was already settled by another path
 * (the atomic guard's loser) so the caller can 409 + close the pending record without harm.
 */
export async function markInvoicePaidWithPop(
  invoiceId: string,
  opts: { photoUrl?: string | null; paymentRef?: string | null; paidVia?: string; popShortLink?: string | null },
): Promise<{ ok: boolean; alreadyPaid: boolean }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, amount: true, orderId: true },
  });
  if (!invoice) return { ok: false, alreadyPaid: false };

  // Atomic guard — only pay a still-open invoice; a concurrent settle makes count === 0.
  const res = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: { in: [...PAYABLE] } },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paidVia: opts.paidVia ?? "Maybank Transfer",
      paymentRef: opts.paymentRef ?? null,
      amountPaid: invoice.amount,
      ...(opts.photoUrl ? { photos: { push: opts.photoUrl } } : {}),
      ...(opts.popShortLink ? { popShortLink: opts.popShortLink } : {}),
    },
  });
  if (res.count === 0) return { ok: false, alreadyPaid: true };

  // Attach the POP to the linked order too (best-effort).
  if (opts.photoUrl && invoice.orderId) {
    await prisma.order
      .update({ where: { id: invoice.orderId }, data: { photos: { push: opts.photoUrl } } })
      .catch(() => {});
  }

  // Duplicate-payment / wrong-account detectors (best-effort — never fail the payment write).
  try {
    const newFlags = await detectPaymentFlags({ invoiceId, paymentRef: opts.paymentRef ?? null });
    if (newFlags.length > 0) {
      const cur = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { flags: true } });
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { flags: mergeFlags(cur?.flags, newFlags) as unknown as Prisma.InputJsonValue },
      });
    }
  } catch (e) {
    console.warn("[mark-invoice-paid] flag detect failed:", e instanceof Error ? e.message : e);
  }

  // POP to the supplier (gated by PROCUREMENT_WHATSAPP_ENABLED, idempotent via popSentAt).
  await sendProofOfPayment(invoiceId).catch(() => {});

  return { ok: true, alreadyPaid: false };
}
