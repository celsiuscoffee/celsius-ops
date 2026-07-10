/**
 * Supplier invoice capture — "auto-upload, humans review".
 *
 * Turns a supplier-sent WhatsApp document/image into a DRAFT invoice: Claude
 * vision reads the billed total / invoice number / dates, the invoice is filed
 * against the right PO (billed-total match), creation flags run
 * (duplicate / over-PO), and the Invoices screen shows the "AI prefilled —
 * verify before paying" banner. Always DRAFT — never triggers payment.
 *
 * Two entry points:
 *  - captureInvoice(...)          — called by the supplier-chat agent when its
 *    classifier says the message is an invoice (ASSIST/AUTO, open PO).
 *  - captureSupplierDocument(evt) — the UNIVERSAL fallback the webhook calls
 *    when the agent didn't capture: OFF suppliers, invoices arriving after the
 *    PO completed (the credit-terms norm), and ad-hoc invoices with no PO.
 *    No LLM classifier in front, so it trusts the parser's docType and files
 *    ONLY "invoice" documents — PoP screenshots / DOs / SOAs are left in the
 *    inbox for their own flows.
 *
 * PO matching: open POs first, then POs COMPLETED in the last 45 days (goods
 * often arrive before the bill), matched by billed total ±2%. No match with a
 * readable total → filed PO-less against the supplier's most recent PO outlet
 * (or the parser's outlet hint), for a human to attach.
 */
import type { OrderStatus } from "@celsius/db";
import type { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { fetchWhatsAppMedia } from "@/lib/whatsapp";
import { storeWhatsAppMedia } from "@/lib/whatsapp-media";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { parseSupplierDoc } from "@/lib/finance/parsers/supplier-doc";
import { detectCreationFlags } from "@/lib/inventory/flag-detector";

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

const OPEN_ORDER_STATUSES: OrderStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "CONFIRMED",
  "AWAITING_DELIVERY",
  "PARTIALLY_RECEIVED",
];

// Invoices routinely arrive AFTER delivery closed the PO (credit terms), so
// recently-completed POs are valid filing targets too.
const COMPLETED_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;

// WhatsApp inbound mime → the subset parseSupplierDoc (Claude vision) accepts.
function visionMime(
  mime: string | undefined,
): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  const m = (mime ?? "").toLowerCase();
  if (m === "application/pdf") return "application/pdf";
  if (m === "image/jpeg" || m === "image/jpg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/webp") return "image/webp";
  return null;
}

export type PoAnchor = {
  id: string;
  orderNumber: string;
  outletId: string;
  totalAmount: unknown;
  status: OrderStatus | null;
};

// A supplier-sent REVISED invoice on a bill we already have on file — surfaced as an ASSIST
// proposal ("update X → Y", a human approves), never auto-applied and never touching a PAID
// invoice. null toAmount/toNumber = that field is unchanged (or unreadable).
export type InvoiceRevision = {
  invoiceId: string;
  invoiceNumber: string;
  orderNumber: string;
  fromAmount: number;
  toAmount: number | null;
  fromNumber: string;
  toNumber: string | null;
};
export type CaptureResult = { captured: boolean; revision: InvoiceRevision | null };

export async function captureInvoice(
  order: PoAnchor | null,
  supplierId: string,
  mediaId: string | null,
  opts: { strictDocType?: boolean } = {},
): Promise<CaptureResult> {
  // ── Try to read the document for a real amount/number/date ──
  let extractedTotal: number | null = null;
  let extractedNumber: string | null = null;
  let billDate: Date | null = null;
  let dueDate: Date | null = null;
  let outletHint: string | null = null;
  let docType: string = "invoice";
  const prefilled: string[] = [];
  if (mediaId) {
    try {
      const media = await fetchWhatsAppMedia(mediaId);
      const mime = visionMime(media?.mimeType);
      if (media && mime) {
        const parsed = await parseSupplierDoc({ fileBytes: media.bytes, mimeType: mime });
        docType = parsed.docType;
        outletHint = parsed.outletHint;
        if (parsed.total != null && parsed.total > 0) {
          extractedTotal = Math.round(parsed.total * 100) / 100;
          prefilled.push("amount");
        }
        if (parsed.billNumber) {
          extractedNumber = parsed.billNumber.slice(0, 64);
          prefilled.push("invoiceNumber");
        }
        if (parsed.billDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.billDate)) {
          billDate = new Date(parsed.billDate);
          prefilled.push("issueDate");
        }
        if (parsed.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate)) {
          dueDate = new Date(parsed.dueDate);
          prefilled.push("dueDate");
        }
      }
    } catch (e) {
      console.warn("[invoice-capture] doc extract failed:", e instanceof Error ? e.message : e);
    }
  }

  // Universal-fallback path: nothing vouched that this is an invoice, so trust
  // only the parser. PoP / DO / SOA / unreadable → leave for their own flows.
  if (opts.strictDocType && docType !== "invoice") {
    console.log(`[invoice-capture] skipped — docType=${docType} (strict)`);
    return { captured: false, revision: null };
  }

  // ── Pick the RIGHT PO for this invoice ──────────────────────────────────
  // The supplier bills per PO, so match the invoice's billed TOTAL to the PO
  // with that total: open POs first, then recently-COMPLETED ones (credit-term
  // invoices arrive after receiving closed the PO). Fall back to the passed
  // `order` when nothing matches / the total is unreadable.
  let target: PoAnchor | null = order;
  let targetConfident = false; // target came from a real billed-total match (not the fallback)
  if (extractedTotal != null) {
    const [openPos, recentDone] = await Promise.all([
      prisma.order.findMany({
        where: { supplierId, orderType: "PURCHASE_ORDER", status: { in: OPEN_ORDER_STATUSES } },
        orderBy: { createdAt: "desc" },
        select: { id: true, orderNumber: true, outletId: true, totalAmount: true, status: true },
      }),
      prisma.order.findMany({
        where: {
          supplierId,
          orderType: "PURCHASE_ORDER",
          status: "COMPLETED",
          updatedAt: { gte: new Date(Date.now() - COMPLETED_LOOKBACK_MS) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, orderNumber: true, outletId: true, totalAmount: true, status: true },
      }),
    ]);
    const candidates = [...openPos, ...recentDone];
    const matches = candidates.filter(
      (p) => Math.abs(Number(p.totalAmount) - extractedTotal!) <= Math.max(1, Number(p.totalAmount) * 0.02),
    );
    if (matches.length >= 1) {
      target = matches[0]; // open-first, most-recent within tolerance
      // Only TRUST the match (enough to drive a revision proposal against this PO) when it is
      // UNIQUE. Two POs near the same total is ambiguous — file against the first but don't
      // let an ambiguous match propose editing that PO's invoice.
      targetConfident = matches.length === 1;
    }
  }

  // Already on file? A re-send of the same bill → skip silently. But a REVISED bill — the
  // same invoice number with a corrected amount, or a re-issued number on the same
  // confidently-matched PO — is surfaced as an ASSIST proposal for a human to approve the
  // update, never silently dropped and never auto-edited. We NEVER propose touching a PAID invoice.
  const amtChanged = (oldAmount: number) =>
    extractedTotal != null && Math.abs(oldAmount - extractedTotal) > Math.max(1, oldAmount * 0.02);

  // A prior invoice is only REVISABLE if no money has moved against it AND it's RECENT —
  // an old invoice sharing a REUSED number (suppliers reset sequences monthly/per book)
  // is a DIFFERENT bill, not a revision.
  const REVISABLE_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
  const isRevisable = (inv: { status: string; amountPaid: unknown; createdAt: Date }): boolean =>
    Number(inv.amountPaid ?? 0) === 0 &&
    inv.status !== "PAID" && inv.status !== "PARTIALLY_PAID" && inv.status !== "DEPOSIT_PAID" &&
    Date.now() - +new Date(inv.createdAt) <= REVISABLE_LOOKBACK_MS;

  // (1) Strong signal: this supplier has a RECENT, fully-unpaid invoice with this exact number,
  //     but the amount changed → a corrected bill.
  const priorSameNo = extractedNumber
    ? await prisma.invoice.findFirst({
        where: { supplierId, invoiceNumber: extractedNumber },
        orderBy: { createdAt: "desc" },
        select: { id: true, invoiceNumber: true, amount: true, status: true, amountPaid: true, createdAt: true, order: { select: { orderNumber: true } } },
      })
    : null;
  if (priorSameNo && isRevisable(priorSameNo) && amtChanged(Number(priorSameNo.amount))) {
    console.log(
      `[invoice-capture] invoice REVISION (amount) ${priorSameNo.invoiceNumber}: ${Number(priorSameNo.amount)} → ${extractedTotal}`,
    );
    return {
      captured: false,
      revision: {
        invoiceId: priorSameNo.id,
        invoiceNumber: priorSameNo.invoiceNumber,
        orderNumber: priorSameNo.order?.orderNumber ?? target?.orderNumber ?? "",
        fromAmount: Number(priorSameNo.amount),
        toAmount: extractedTotal,
        fromNumber: priorSameNo.invoiceNumber,
        toNumber: null,
      },
    };
  }
  if (priorSameNo && !amtChanged(Number(priorSameNo.amount))) {
    // Exact re-send of a bill we already hold — nothing to do.
    console.log(`[invoice-capture] skipped — ${priorSameNo.invoiceNumber} already on file (same amount)`);
    return { captured: false, revision: null };
  }
  // Same number, DIFFERENT amount, but the prior invoice isn't revisable (paid,
  // or too old — suppliers reset sequences monthly/per book): this is a NEW
  // bill re-using a number, not a correction. File it under a de-collided
  // number instead of letting the unique (supplierId, invoiceNumber) constraint
  // silently swallow the create below.
  if (priorSameNo && extractedNumber && amtChanged(Number(priorSameNo.amount)) && !isRevisable(priorSameNo)) {
    extractedNumber = `${extractedNumber} (2)`.slice(0, 64);
    console.log(`[invoice-capture] number reuse — filing as "${extractedNumber}" (prior is paid/old, not a revision)`);
  }

  if (target) {
    // Dedup anchor: the invoice already filed against this PO.
    const priorOnPo = await prisma.invoice.findFirst({
      where: { orderId: target.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, invoiceNumber: true, amount: true, status: true, amountPaid: true, createdAt: true },
    });
    if (priorOnPo) {
      // (2) Re-issued invoice number on the SAME, UNIQUELY-matched PO → a replacement
      //     invoice: propose the number/amount update.
      const numberChanged = !!extractedNumber && extractedNumber !== priorOnPo.invoiceNumber;
      if (targetConfident && isRevisable(priorOnPo) && numberChanged && !priorSameNo) {
        console.log(
          `[invoice-capture] invoice REVISION (number) po=${target.orderNumber} ${priorOnPo.invoiceNumber} → ${extractedNumber}`,
        );
        return {
          captured: false,
          revision: {
            invoiceId: priorOnPo.id,
            invoiceNumber: priorOnPo.invoiceNumber,
            orderNumber: target.orderNumber,
            fromAmount: Number(priorOnPo.amount),
            toAmount: amtChanged(Number(priorOnPo.amount)) ? extractedTotal : null,
            fromNumber: priorOnPo.invoiceNumber,
            toNumber: extractedNumber,
          },
        };
      }
      console.log(`[invoice-capture] skipped — ${target.orderNumber} already has an invoice`);
      return { captured: false, revision: null };
    }
  }

  // ── Resolve where the invoice lands ──
  // With a PO target: that PO + its outlet. Without one (ad-hoc / unmatched):
  // file PO-less — but only when the document was READABLE (a provisional
  // amount needs a PO total to borrow, and a blind RM0 draft is just noise).
  const orderId: string | null = target?.id ?? null;
  let outletId: string | null = target?.outletId ?? null;
  let amount: number;
  let provisional = false;
  if (target) {
    amount = extractedTotal ?? (Number(target.totalAmount) || 0);
    provisional = extractedTotal == null;
  } else {
    if (extractedTotal == null) {
      console.log("[invoice-capture] skipped — no PO match and document total unreadable");
      return { captured: false, revision: null };
    }
    amount = extractedTotal;
    // Outlet: parser's delivery-address hint → else the supplier's most recent PO's outlet.
    if (outletHint) {
      const outlets = await prisma.outlet.findMany({ select: { id: true, name: true } });
      const hint = outletHint.toLowerCase();
      outletId =
        outlets.find((o) => hint.includes(o.name.toLowerCase()) || o.name.toLowerCase().includes(hint))?.id ?? null;
    }
    if (!outletId) {
      const lastPo = await prisma.order.findFirst({
        where: { supplierId, orderType: "PURCHASE_ORDER" },
        orderBy: { createdAt: "desc" },
        select: { outletId: true },
      });
      outletId = lastPo?.outletId ?? null;
    }
    if (!outletId) {
      console.log("[invoice-capture] skipped — PO-less invoice but no outlet resolvable");
      return { captured: false, revision: null };
    }
  }

  const invoiceNumber =
    extractedNumber ||
    (target ? `AI-${target.orderNumber}` : `AI-DOC-${new Date().toISOString().slice(0, 10)}-${(mediaId ?? "x").slice(-6)}`);

  // Persist the supplier-sent document so the captured invoice keeps the photo
  // (idempotent — the inbox webhook stored it under the same deterministic path).
  const photoUrl = await storeWhatsAppMedia(mediaId);

  try {
    const flags = await detectCreationFlags({
      orderId: orderId ?? undefined,
      supplierId,
      amount,
      issueDate: billDate,
    });
    const created = await prisma.invoice.create({
      data: {
        invoiceNumber,
        ...(orderId ? { orderId } : {}),
        outletId: outletId!,
        supplierId,
        amount: amount as never, // Decimal passthrough
        status: "DRAFT",
        paymentType: "SUPPLIER",
        photos: photoUrl ? [photoUrl] : [],
        ...(billDate ? { issueDate: billDate } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(prefilled.length > 0
          ? { aiPrefilledAt: new Date(), aiPrefilledFields: JSON.stringify(prefilled) }
          : {}),
        ...(flags.length > 0 ? { flags: flags as unknown as Prisma.InputJsonValue } : {}),
        notes: provisional
          ? "Captured from WhatsApp by the supplier-chat agent — document unreadable, amount is provisional (PO total); " +
            `verify against the document before paying.${mediaId ? ` [wa-media:${mediaId}]` : ""}`
          : (orderId
              ? "Captured + read from WhatsApp by the supplier-chat agent — amount/number extracted from the document; "
              : "Captured + read from WhatsApp (no matching PO — attach one if applicable); ") +
            `verify before paying.${mediaId ? ` [wa-media:${mediaId}]` : ""}`,
      },
      select: { id: true },
    });
    // Receiving an invoice means the supplier confirmed + is fulfilling → move the PO to
    // Awaiting Delivery, matching the manual "Upload Invoice & Send" flow. Only from a
    // sent/approved state; best-effort.
    if (target?.status && (["APPROVED", "SENT", "CONFIRMED"] as OrderStatus[]).includes(target.status)) {
      await prisma.order
        .update({ where: { id: target.id }, data: { status: "AWAITING_DELIVERY" } })
        .catch((e) => console.warn("[invoice-capture] PO→AWAITING_DELIVERY failed:", e instanceof Error ? e.message : e));
    }
    console.log(
      `[invoice-capture] captured id=${created.id} no=${invoiceNumber} po=${target?.orderNumber ?? "-"} ` +
        `amount=${amount} extracted=${!provisional} prefilled=${prefilled.join("|") || "-"} flags=${flags.length}`,
    );
    return { captured: true, revision: null };
  } catch (e) {
    // Unique (supplierId, invoiceNumber) collision (already captured) or any write error.
    console.warn("[invoice-capture] capture skipped:", e instanceof Error ? e.message : e);
    return { captured: false, revision: null };
  }
}

export interface SupplierDocumentEvent {
  fromNumber: string;
  type?: string;
  mediaId?: string | null;
}

/**
 * Universal capture fallback — called from the WhatsApp webhook for any
 * supplier document/image the chat agent did NOT capture (OFF suppliers, no
 * open PO, invoice-after-completion, ad-hoc). Internal filing only: never
 * replies to the supplier, so it runs regardless of the automation dial.
 * Never throws.
 */
export async function captureSupplierDocument(evt: SupplierDocumentEvent): Promise<void> {
  try {
    if (process.env.PROCUREMENT_AGENT_ENABLED !== "true" || !process.env.ANTHROPIC_API_KEY) return;
    if (evt.type !== "document" && evt.type !== "image") return;
    if (!evt.mediaId) return;

    const tail = digits(evt.fromNumber).slice(-8);
    if (tail.length < 8) return;
    const suppliers = await prisma.supplier.findMany({
      where: { phone: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true, phone: true },
    });
    const supplier = suppliers.find((s) => {
      const sd = digits(s.phone);
      return sd.length >= 8 && sd.slice(-8) === tail;
    });
    if (!supplier) return;

    // Most recent open PO (if any) as the provisional anchor — captureInvoice
    // does the real matching (open + recently-completed) itself.
    const anchor = await prisma.order.findFirst({
      where: { supplierId: supplier.id, orderType: "PURCHASE_ORDER", status: { in: OPEN_ORDER_STATUSES } },
      orderBy: { createdAt: "desc" },
      select: { id: true, orderNumber: true, outletId: true, totalAmount: true, status: true },
    });

    const res = await captureInvoice(anchor ?? null, supplier.id, evt.mediaId, { strictDocType: true });
    if (res.captured) {
      console.log(`[invoice-capture] fallback captured for ${supplier.name}`);
    }
    // A REVISION means the supplier re-sent a bill we already hold with a
    // corrected amount/number — the CREDIT-TERMS NORM when the real invoice
    // arrives after receiving created a placeholder. The chat agent surfaces
    // revisions as an ASSIST proposal; this fallback path used to just DROP
    // them (OFF suppliers / post-completion invoices vanished without a
    // trace). Record the same proposal shape as an internal note so the
    // thread banner + needs-attention list pick it up and a human approves
    // the update — never auto-applied.
    if (res.revision) {
      await recordRevisionProposal(supplier.id, evt.fromNumber, res.revision);
    }
  } catch (err) {
    console.error("[invoice-capture] fallback error:", err instanceof Error ? err.message : err);
  }
}

// Internal escalation note carrying an invoiceAction proposal — mirrors the
// chat agent's raw.proposal shape so the supplier-chats banner and Approve
// flow work on it unchanged. Deduped per (invoice, proposed amount/number).
async function recordRevisionProposal(
  supplierId: string,
  fromNumber: string,
  revision: InvoiceRevision,
): Promise<void> {
  try {
    const dedupeKey = `${revision.invoiceId}:${revision.toAmount ?? ""}:${revision.toNumber ?? ""}`;
    const already = await prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", raw: { path: ["revisionProposalKey"], equals: dedupeKey } },
      select: { id: true },
    });
    if (already) return;
    const change = [
      revision.toAmount != null ? `amount RM${revision.fromAmount} → RM${revision.toAmount}` : null,
      revision.toNumber ? `number ${revision.fromNumber} → ${revision.toNumber}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    await recordOutboundMessage({
      waMessageId: undefined,
      fromNumber: "",
      toNumber: fromNumber.replace(/\D/g, ""),
      type: "text",
      body: `📄 Supplier sent a revised invoice for ${revision.orderNumber || revision.invoiceNumber}: ${change || "details updated"}. Review + approve the update. (Internal note.)`,
      supplierId,
      status: "note",
      raw: {
        agent: "invoice-capture-fallback",
        escalated: true,
        revisionProposalKey: dedupeKey,
        proposal: {
          intent: "invoice_or_soa",
          escalationReason: "supplier sent a revised invoice (universal capture)",
          orderId: null,
          poAction: null,
          invoiceAction: revision,
        },
      },
    });
    console.log(`[invoice-capture] revision proposal recorded for invoice ${revision.invoiceNumber}`);
  } catch (e) {
    console.warn("[invoice-capture] revision proposal failed:", e instanceof Error ? e.message : e);
  }
}
