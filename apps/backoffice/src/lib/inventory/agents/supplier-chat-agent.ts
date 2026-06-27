/**
 * Supplier-chat AI agent — full-auto procurement conversation handler.
 *
 * On an inbound WhatsApp message from a matched supplier that has an open PO,
 * this reads the message in context (recent thread + the PO's line items),
 * works out what the supplier means and acts:
 *   - auto-replies to the supplier in THEIR language (Malay / English / mix),
 *   - edits the open PO for clear OOS / quantity cases (remove / reduce a line),
 *   - updates the PO delivery date when the supplier states when they'll deliver,
 *   - captures an invoice/SOA the supplier sends as a DRAFT invoice on the PO
 *     (amount left provisional for a human to verify — it can't read the PDF).
 *
 * Guardrails are enforced in CODE, not left to the model:
 *   - Off unless PROCUREMENT_AGENT_ENABLED=true.
 *   - Only acts for suppliers on PROCUREMENT_AGENT_ALLOWLIST (last-8 phone digits)
 *     when set — so the first live run is scoped to the Test supplier.
 *   - substitutions, full cancellations, payment/PoP/reconciliation, complaints,
 *     and ANY low-confidence call ESCALATE: a safe holding reply, no PO change.
 *   - every decision is stamped on the outbound message's `raw` for audit, and
 *     used to de-dupe Meta webhook redeliveries.
 *
 * Sends use sendWhatsAppText (the app's own permanent token, server-side). Never
 * throws — callers can await it without risking the webhook's 200.
 *
 * Model: claude-sonnet-4-6 — it edits real POs and writes to real suppliers.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { OrderStatus, Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText, fetchWhatsAppMedia } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { parseSupplierDoc } from "@/lib/finance/parsers/supplier-doc";
import { detectCreationFlags } from "@/lib/inventory/flag-detector";
import { paymentModel, type PaymentModelInfo } from "@/lib/inventory/payment-model";
import { createReSourcePO } from "@/lib/inventory/agents/resource-po";
import { verifierEnabled, verifyMessage } from "@/lib/inventory/agents/verifier-run";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const SUPPLIER_AGENT_VERSION = "supplier-chat-agent-v3";

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

// "Open" = a PO still in flight (everything except the terminal states).
const OPEN_ORDER_STATUSES: OrderStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "CONFIRMED",
  "AWAITING_DELIVERY",
  "PARTIALLY_RECEIVED",
];

type PoActionType = "none" | "remove_item" | "reduce_qty" | "substitute_item" | "cancel_order";

type PoAction = {
  type: PoActionType;
  po_item_id: string | null;
  new_quantity: number | null;
  note: string | null;
};

type AgentDecision = {
  intent: string;
  language: "ms" | "en" | "mixed";
  // One entry per line the supplier flags — so a single "Earl Grey 5, Peppermint 3,
  // Orange habis" message resolves all three at once (the multi-item fix).
  po_actions: PoAction[];
  // Primary action = po_actions[0] (or none). Kept for the verifier / inbox proposal.
  po_action: PoAction;
  delivery_date: string | null; // YYYY-MM-DD when the supplier states a future delivery day
  capture_invoice: boolean; // true when this message is the supplier sending their invoice/SOA
  reply_text: string;
  confidence: number;
  requires_human: boolean;
  escalation_reason: string | null;
};

const NO_ACTION: PoAction = { type: "none", po_item_id: null, new_quantity: null, note: null };

export interface SupplierMessageEvent {
  fromNumber: string; // supplier's number (digits or +form)
  toNumber: string; // our business number
  text: string;
  waMessageId?: string;
  type?: string; // WhatsApp message type: text | document | image | …
  mediaId?: string | null; // media id for document/image (the invoice PDF, etc.)
}

// Fallback only — used when the model returns no reply on an escalation. The agent
// normally sends its own specific, varied holding line (see the playbook), so this
// canned text is rarely seen. No "check with the team" deferral.
const HOLDING_REPLY = {
  ms: "Ok noted, saya semak dulu dan revert sekejap.",
  en: "Ok noted, let me check on this and revert shortly.",
};

function flagEnabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}

// Which suppliers the agent may act on is now a per-supplier dial (Supplier.automationMode):
// OFF = hands-off, ASSIST = draft + human-approve, AUTO = act + send. This replaces the
// old global PROCUREMENT_AGENT_ALLOWLIST; PROCUREMENT_AGENT_ENABLED stays the master switch.

const isValidIsoDate = (d: string | null): d is string =>
  !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** Today's date in Malaysia (UTC+8), YYYY-MM-DD — so the model can resolve "esok"/"Rabu". */
function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Human takeover: once a human replies from the inbox, the agent stands down on that
// thread for this long so it doesn't talk over them. Auto-resumes after.
const HUMAN_TAKEOVER_MS = (Number(process.env.PROCUREMENT_HUMAN_TAKEOVER_HOURS) || 6) * 60 * 60 * 1000;
// A human-typed reply (inbox composer) carries no system marker; agent + cron senders
// all stamp one — so "no known marker" ⇒ a human sent it.
function isHumanOutbound(raw: Record<string, unknown> | null | undefined): boolean {
  const r = raw ?? {};
  return (
    !r.agent && !r.invoiceRequestFor && !r.receivingChaseFor && !r.poSentFor && !r.execBriefDate && !r.soaHandoffFor && !r.promiseChaseFor
  );
}

/**
 * Entry point. Safe to `await` from the webhook — never throws, no-ops fast for
 * non-suppliers / disabled flag.
 */
export async function handleSupplierMessage(evt: SupplierMessageEvent): Promise<void> {
  try {
    if (!flagEnabled() || !process.env.ANTHROPIC_API_KEY) return;

    const hasDoc = evt.type === "document" || evt.type === "image";
    const fromDigits = digits(evt.fromNumber);
    const tail = fromDigits.slice(-8);
    if (tail.length < 8) return;
    if (!evt.text.trim() && !hasDoc) return; // nothing to act on

    // Match the supplier by last-8 digits (same rule as whatsapp-store).
    const suppliers = await prisma.supplier.findMany({
      where: { phone: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true, phone: true, paymentTerms: true, depositPercent: true, automationMode: true },
    });
    const supplier = suppliers.find((s) => {
      const sd = digits(s.phone);
      return sd === fromDigits || (sd.length >= 8 && sd.slice(-8) === tail);
    });
    // Per-supplier dial: OFF → hands-off (leave to humans). ASSIST/AUTO continue;
    // ASSIST forces escalate below (draft + human-approve, never auto-act).
    if (!supplier || supplier.automationMode === "OFF") return;

    // Redelivery dedupe: if we've already auto-answered this exact inbound, stop.
    if (evt.waMessageId) {
      const already = await prisma.whatsAppMessage.findFirst({
        where: { direction: "outbound", raw: { path: ["inReplyTo"], equals: evt.waMessageId } },
        select: { id: true },
      });
      if (already) return;
    }

    // Human takeover: if the last thing WE sent this supplier was typed by a human
    // (inbox composer) within the takeover window, stand down — they're handling this
    // thread. Stops the agent talking over a human who's stepped in. Auto-resumes once
    // the human goes quiet past the window (or set the supplier to OFF to pause for good).
    const lastOut = await prisma.whatsAppMessage.findFirst({
      where: { toNumber: fromDigits, direction: "outbound" },
      orderBy: { timestamp: "desc" },
      select: { raw: true, timestamp: true },
    });
    if (
      lastOut &&
      isHumanOutbound(lastOut.raw as Record<string, unknown> | null) &&
      Date.now() - +new Date(lastOut.timestamp) < HUMAN_TAKEOVER_MS
    ) {
      console.log(`[supplier-agent] standing down — human is handling ${supplier.name}`);
      return;
    }

    // Most recent open PO for this supplier + its line items + invoice presence.
    const order = await prisma.order.findFirst({
      where: {
        supplierId: supplier.id,
        orderType: "PURCHASE_ORDER",
        status: { in: OPEN_ORDER_STATUSES },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        outletId: true,
        totalAmount: true,
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            product: { select: { name: true, baseUom: true } },
          },
        },
        invoices: { select: { id: true }, take: 1 },
      },
    });
    if (!order) return; // no open PO — nothing to act on

    // Recent thread for context (chronological, last 8).
    const history = await prisma.whatsAppMessage.findMany({
      where: { supplierId: supplier.id },
      orderBy: { timestamp: "desc" },
      take: 8,
      select: { direction: true, body: true },
    });
    history.reverse();

    const pm = paymentModel(supplier);
    const decision = await classify(evt.text, supplier, order, history, todayMyt(), hasDoc, pm);
    if (!decision) return;

    // ── Guardrails (code, not model): auto-act vs escalate ──
    // Accountable by default: act on clear shortfalls (reduce/remove every flagged line
    // + re-source each OOS) instead of deferring. Escalate ONLY when the model flags
    // genuine ambiguity (requires_human), a risky swap/cancel, or the supplier is on
    // ASSIST. No confidence-threshold gate — that was escalating clean multi-item
    // shortfalls; the independent verifier backstops every auto-act instead.
    const actions = decision.po_actions.filter((a) => a.type !== "none");
    const hasRisky = actions.some((a) => a.type === "substitute_item" || a.type === "cancel_order");
    const escalate = decision.requires_human || hasRisky || supplier.automationMode === "ASSIST";

    const lang: "ms" | "en" = decision.language === "ms" ? "ms" : "en";
    let replyText = decision.reply_text?.trim();
    let appliedAction: PoActionType = "none";
    const appliedActions: PoActionType[] = [];
    let deliveryUpdated: string | null = null;
    let invoiceCaptured = false;
    type ReSource = { orderId: string; supplierName: string; orderNumber: string; qty: number; unit: string; existing: boolean };
    let reSource: ReSource | null = null;
    const reSources: ReSource[] = [];

    if (escalate) {
      // Keep the model's OWN holding line — it's specific to this message + varied (the
      // playbook makes it honest + non-committal). Fall back to the canned line only if
      // it came back empty, so we never confirm an action we're not taking.
      replyText = decision.reply_text?.trim() || HOLDING_REPLY[lang];
    } else {
      // Fetch the system user once if any line is being removed (for the re-source PO).
      const systemUser = actions.some((a) => a.type === "remove_item")
        ? await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } })
        : null;
      for (const a of actions) {
        if (a.type !== "remove_item" && a.type !== "reduce_qty") continue;
        const actionResult = await applyPoAction(order.id, a);
        if (actionResult.type !== "none") appliedActions.push(actionResult.type);
        // OOS removal → open a DRAFT re-source PO to the next-cheapest supplier so the
        // need isn't dropped. Internal only — never surfaced to THIS supplier.
        if (actionResult.type === "remove_item" && actionResult.removed && systemUser) {
          const rs = await createReSourcePO({
            productId: actionResult.removed.productId,
            productName: actionResult.removed.productName,
            baseQtyNeeded: actionResult.removed.baseQty,
            fromSupplierId: supplier.id,
            fromSupplierName: supplier.name,
            outletId: order.outletId,
            systemUserId: systemUser.id,
          });
          if (rs) reSources.push(rs);
        }
      }
      appliedAction = appliedActions[0] ?? "none";
      reSource = reSources[0] ?? null;
      if (isValidIsoDate(decision.delivery_date)) {
        await applyDeliveryDate(order.id, decision.delivery_date);
        deliveryUpdated = decision.delivery_date;
      }
      if (decision.capture_invoice && order.invoices.length === 0) {
        invoiceCaptured = await captureInvoice(
          { id: order.id, orderNumber: order.orderNumber, outletId: order.outletId, totalAmount: order.totalAmount },
          supplier.id,
          evt.mediaId ?? null,
        );
      }
    }
    if (!replyText) replyText = HOLDING_REPLY[lang];

    // When we escalate, capture a STRUCTURED PROPOSAL of the action we declined
    // to auto-apply (e.g. the substitution swap, the qty change) so the inbox can
    // show the human a concrete "AI suggests …" they can accept or reject —
    // rather than just "needs attention". Read-only: the agent never applies it.
    const proposedItem =
      decision.po_action.po_item_id
        ? order.items.find((i) => i.id === decision.po_action.po_item_id)
        : undefined;
    const proposal = escalate
      ? {
          intent: decision.intent,
          escalationReason: decision.escalation_reason ?? "guardrail",
          paymentModel: pm.model,
          popDeliveryCritical: pm.popDeliveryCritical,
          orderId: order.id,
          poAction:
            decision.po_action.type !== "none"
              ? {
                  type: decision.po_action.type,
                  poItemId: decision.po_action.po_item_id,
                  itemName: proposedItem?.product.name ?? null,
                  newQuantity: decision.po_action.new_quantity,
                  note: decision.po_action.note,
                }
              : null,
        }
      : null;

    // Snapshot exactly what the agent saw + did, so the independent verifier
    // agent can re-judge this decision later (Agent QA) without reconstructing
    // mutable PO state. Compact by design.
    const verifierInput = {
      supplierName: supplier.name,
      paymentModel: pm.label,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      items: order.items.map((it) => ({
        name: it.product.name,
        qty: Number(it.quantity),
        unit: it.product.baseUom,
        unitPrice: Number(it.unitPrice),
      })),
      thread: history
        .filter((m) => m.body)
        .map((m) => ({ who: m.direction === "inbound" ? "Supplier" : "Us", text: m.body as string })),
      inboundText: evt.text.trim() || (hasDoc ? "[document, no caption]" : ""),
      hadDoc: hasDoc,
      today: todayMyt(),
    };
    const verifierDecision = {
      intent: decision.intent,
      language: decision.language,
      actionType: decision.po_action.type,
      actionItemName:
        order.items.find((i) => i.id === decision.po_action.po_item_id)?.product.name ?? null,
      newQuantity: decision.po_action.new_quantity,
      deliveryDate: deliveryUpdated,
      captureInvoice: invoiceCaptured,
      replyText,
      confidence: decision.confidence,
      escalated: escalate,
      escalationReason: escalate ? (decision.escalation_reason ?? "guardrail") : null,
      appliedAction,
      reSourced: !!reSource,
    };

    // Auto-reply (24h window is open — the supplier just messaged us).
    const sent = await sendWhatsAppText(supplier.phone ?? fromDigits, replyText);

    const recordedId = await recordOutboundMessage({
      waMessageId: sent.messageId,
      fromNumber: digits(evt.toNumber),
      toNumber: fromDigits,
      type: "text",
      body: replyText,
      supplierId: supplier.id,
      status: sent.ok ? "sent" : "failed",
      raw: {
        agent: SUPPLIER_AGENT_VERSION,
        inReplyTo: evt.waMessageId ?? null,
        intent: decision.intent,
        confidence: decision.confidence,
        appliedAction,
        appliedActions,
        deliveryUpdated,
        invoiceCaptured,
        escalated: escalate,
        escalationReason: escalate ? (decision.escalation_reason ?? "guardrail") : null,
        poNumber: order.orderNumber,
        paymentModel: pm.model,
        proposal,
        reSource,
        reSources,
        verifierInput,
        verifierDecision,
      },
    });

    // Close the loop: the independent verifier checks EVERY decision the moment
    // it's made (the reply is already sent, so this never delays the supplier).
    // It only stamps a verdict — a "fail" surfaces the thread as needs-attention
    // in the inbox (see supplier-chats list), pulling a human in exactly when the
    // check catches something. Best-effort, gated, never throws.
    if (recordedId && verifierEnabled()) {
      try {
        const verdict = await verifyMessage(recordedId);
        if (verdict) {
          console.log(
            `[supplier-agent] verifier po=${order.orderNumber} rating=${verdict.rating} ` +
              `conf=${verdict.confidence.toFixed(2)}${verdict.issues.length ? ` issues=${verdict.issues.length}` : ""}`,
          );
        }
      } catch (e) {
        console.warn("[supplier-agent] auto-verify failed:", e instanceof Error ? e.message : e);
      }
    }

    console.log(
      `[supplier-agent] supplier=${supplier.name} po=${order.orderNumber} intent=${decision.intent} ` +
        `conf=${decision.confidence.toFixed(2)} action=${appliedAction} delivery=${deliveryUpdated ?? "-"} ` +
        `invoice=${invoiceCaptured} escalate=${escalate} sent=${sent.ok}` +
        (reSource ? ` reSource=${reSource.orderNumber}->${reSource.supplierName}(${reSource.qty}${reSource.existing ? ",existing" : ""})` : ""),
    );
  } catch (err) {
    // Never let the agent break the webhook's 200.
    console.error("[supplier-agent] error:", err instanceof Error ? err.message : err);
  }
}

type RemovedLine = { productId: string; productName: string; baseQty: number };

/**
 * Apply a vetted, low-risk edit to the PO and recompute its total. For an OOS
 * removal it also returns the removed line (base units) so the caller can
 * re-source it from another supplier.
 */
async function applyPoAction(
  orderId: string,
  action: AgentDecision["po_action"],
): Promise<{ type: PoActionType; removed?: RemovedLine }> {
  if (!action.po_item_id) return { type: "none" };
  const item = await prisma.orderItem.findFirst({
    where: { id: action.po_item_id, orderId }, // ensure the line belongs to THIS order
    select: {
      id: true,
      unitPrice: true,
      quantity: true,
      productId: true,
      product: { select: { name: true } },
      productPackage: { select: { conversionFactor: true } },
    },
  });
  if (!item) return { type: "none" };

  let removed: RemovedLine | undefined;
  if (action.type === "remove_item") {
    const conv = item.productPackage ? Number(item.productPackage.conversionFactor) : 1;
    removed = {
      productId: item.productId,
      productName: item.product?.name ?? "item",
      baseQty: Number(item.quantity) * (conv > 0 ? conv : 1),
    };
    await prisma.orderItem.delete({ where: { id: item.id } });
  } else if (action.type === "reduce_qty" && action.new_quantity && action.new_quantity > 0) {
    const q = action.new_quantity;
    await prisma.orderItem.update({
      where: { id: item.id },
      data: { quantity: q, totalPrice: Number(item.unitPrice) * q },
    });
  } else {
    return { type: "none" };
  }

  // Recompute the order total from the remaining lines.
  const remaining = await prisma.orderItem.findMany({
    where: { orderId },
    select: { totalPrice: true },
  });
  const total = remaining.reduce((s, i) => s + Number(i.totalPrice), 0);
  await prisma.order.update({ where: { id: orderId }, data: { totalAmount: total } });
  return { type: action.type, removed };
}

/** Update the PO's delivery date (informational — safe to auto-apply). */
async function applyDeliveryDate(orderId: string, isoDate: string): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { deliveryDate: new Date(isoDate) } });
}

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

/**
 * Capture a supplier-sent invoice as a DRAFT invoice on the PO.
 *
 * The agent now READS the document: it downloads the media and runs the shared
 * supplier-doc vision parser to extract the real billed total, the supplier's
 * own invoice number, and the bill/due dates. Those land as AI-prefilled fields
 * (aiPrefilledAt set) so the Invoices screen surfaces a "verify before paying"
 * banner — a human still confirms the amount. Creation flags run so a duplicate
 * PO / billed-over-PO mismatch is caught immediately. If the media can't be
 * fetched or parsed (or the total is unreadable), we fall back to the old
 * provisional capture (amount = PO total). Always DRAFT → never triggers payment.
 */
async function captureInvoice(
  order: { id: string; orderNumber: string; outletId: string; totalAmount: unknown },
  supplierId: string,
  mediaId: string | null,
): Promise<boolean> {
  // ── Try to read the document for a real amount/number/date ──
  let extractedTotal: number | null = null;
  let extractedNumber: string | null = null;
  let billDate: Date | null = null;
  let dueDate: Date | null = null;
  const prefilled: string[] = [];
  if (mediaId) {
    try {
      const media = await fetchWhatsAppMedia(mediaId);
      const mime = visionMime(media?.mimeType);
      if (media && mime) {
        const parsed = await parseSupplierDoc({ fileBytes: media.bytes, mimeType: mime });
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
      console.warn("[supplier-agent] doc extract failed:", e instanceof Error ? e.message : e);
    }
  }

  const amount = extractedTotal ?? (Number(order.totalAmount) || 0);
  const invoiceNumber = extractedNumber || `AI-${order.orderNumber}`;
  const provisional = extractedTotal == null;

  try {
    const flags = await detectCreationFlags({
      orderId: order.id,
      supplierId,
      amount,
      issueDate: billDate,
    });
    const created = await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: order.id,
        outletId: order.outletId,
        supplierId,
        amount: amount as never, // Decimal passthrough
        status: "DRAFT",
        paymentType: "SUPPLIER",
        ...(billDate ? { issueDate: billDate } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(prefilled.length > 0
          ? { aiPrefilledAt: new Date(), aiPrefilledFields: JSON.stringify(prefilled) }
          : {}),
        ...(flags.length > 0 ? { flags: flags as unknown as Prisma.InputJsonValue } : {}),
        notes: provisional
          ? "Captured from WhatsApp by the supplier-chat agent — document unreadable, amount is provisional (PO total); " +
            `verify against the document before paying.${mediaId ? ` [wa-media:${mediaId}]` : ""}`
          : "Captured + read from WhatsApp by the supplier-chat agent — amount/number extracted from the document; " +
            `verify before paying.${mediaId ? ` [wa-media:${mediaId}]` : ""}`,
      },
      select: { id: true },
    });
    console.log(
      `[supplier-agent] invoice captured id=${created.id} no=${invoiceNumber} ` +
        `amount=${amount} extracted=${!provisional} prefilled=${prefilled.join("|") || "-"} flags=${flags.length}`,
    );
    return true;
  } catch (e) {
    // Unique invoiceNumber collision (already captured) or any write error.
    console.warn(
      "[supplier-agent] invoice capture skipped:",
      e instanceof Error ? e.message : e,
    );
    return false;
  }
}

type SupplierCtx = { name: string; paymentTerms: string | null };
type OrderCtx = {
  orderNumber: string;
  status: OrderStatus;
  items: Array<{
    id: string;
    quantity: Prisma_Decimalish;
    unitPrice: Prisma_Decimalish;
    product: { name: string; baseUom: string };
  }>;
};
// Prisma Decimal serialises via Number(); we only ever read it numerically here.
type Prisma_Decimalish = { toString(): string };

const AGENT_ROLE = `You are the procurement assistant for Celsius Coffee, a Malaysian specialty-coffee chain. You handle WhatsApp chats with SUPPLIERS for the buying team: read each message in the context of the supplier's open purchase order, reply the way a Celsius ops person would, and — only for clearly safe cases — adjust the PO. Output ONLY a JSON object, no prose.`;

// Static voice + glossary + decision policy, distilled from 17 real Celsius
// supplier chat logs (docs/design/procurement-chat-learnings.md). Marked for
// prompt caching — identical on every call. The hard escalation rules are the
// real lesson: suppliers casually offer "same quality" subs that aren't recipe-safe.
const PLAYBOOK = `# Voice — natural and friendly, like a real Celsius buyer on WhatsApp
Casual is good. Reply in the supplier's language (Malay / English / casual Manglish), warm and easy, brief. The ONLY problems are OVERUSING things — keep these in check:
- "bos"/"boss": fine once in a while, NOT on every message and never doubled ("bos bos"). Most replies just skip it.
- Emoji: occasional is fine (a single 🙏 or 👌 now and then), but most replies need NONE. Never one on every message.
- DON'T repeat: never reuse the same sentence, greeting, or sign-off you've already used in this thread. Vary your wording, don't re-greet mid-conversation, don't repeat thank-yous, no filler, never "let me confirm with the team".
- No em-dashes or en-dashes ("—"/"–"); use commas or full stops. Plain WhatsApp text.
- Be specific and brief: name the actual item / qty / date, one or two sentences.

# Supplier phrasing you must understand (Malay / Manglish)
- Out of stock: takde, xde, x ada, dah habis, dah abis, kosong, "no stock", OOS, "dry stock".
- Short quantity: "ada sikit je", "boleh bagi X je", "tinggal X".
- Delivery/ETA: "boleh hantar bila", "bila sampai", harini=today, esok=tomorrow, otw, "dah hantar/sampai". Days: Isnin Mon, Selasa Tue, Rabu Wed, Khamis Thu, Jumaat Fri, Sabtu Sat.
- Price: berapa, "1 ctn ada brp", "RM9 per pc". Invoice: "keluarkan invois", SOA (statement of account), "resend invoice".
- Payment: "attached PoP", "dah initiate", "clear payment first" (pay before they release), "received with thanks".
- MOQ: "below MOQ", "add something more", "trip min RMxxx". Closure: cuti, tutup, "off day", Raya/CNY/PH notices.
- Units: ctn carton, pkt packet, pcs, btl bottle, kg, kotak box, tin. boleh=ok/can, faham=understood.

# You may act AUTONOMOUSLY (set the field + a confirming reply):
- remove_item — only when it is unambiguous WHICH line is out of stock.
- reduce_qty — only when they state a smaller available quantity for a specific line.
- delivery_date — when they state WHEN they'll deliver ("hantar Rabu", "esok", a date). Resolve it to an absolute YYYY-MM-DD relative to today. "dah hantar"/"otw"/"sampai" (already sent / on the way) is NOT a future date → delivery_date null.
- capture_invoice — when this message is them SENDING their invoice/SOA (especially a document on a PO with no invoice yet). We save it as a DRAFT for a human to verify the amount, so just acknowledge ("terima invois, thank you") — do NOT discuss or confirm the amount.
If they say something is out/short but NOT which item → ask which, change nothing. Never guess.

# You MUST escalate (requires_human=true, change nothing). Still write a SPECIFIC reply_text that names the exact thing you're checking and says you'll revert, e.g. "Ok let me check on the Yamama swap and revert." / "Let me confirm the new price and get back to you." Never accept/confirm the action, and never reuse the same holding sentence twice in a thread.
- ANY substitution offer, even "same quality / identical" — Celsius recipes are fat-%/grade/brand-sensitive (e.g. cream 35.7% vs 35.1%). Relay it; never accept it.
- price increase / committing to a quote; MOQ top-up decisions.
- payment, proof-of-payment, payment-gating, and reconciliation queries ("is this PoP for inv -0142 or -0143?").
- complaints / damaged / wrong goods; e-invoice / PO-number / TIN / compliance; credit-term questions.
- ambiguous quantity or unit ("2.5kg only", "1 ctn ada brp") → ask to clarify, do not assume.

# Handle conversationally, change nothing, requires_human=false:
order confirmations, greetings, closure / holiday notices, lead-time notes — acknowledge politely or ask a brief clarifying question.

Be conservative: confidence >0.7 ONLY when the intended action is unambiguous.`;

async function classify(
  text: string,
  supplier: SupplierCtx,
  order: OrderCtx,
  history: Array<{ direction: string; body: string | null }>,
  today: string,
  hasDoc: boolean,
  pm: PaymentModelInfo,
): Promise<AgentDecision | null> {
  const items = order.items
    .map(
      (it) =>
        `- po_item_id=${it.id} | ${it.product.name} | qty ${Number(it.quantity)} ${it.product.baseUom} | RM ${Number(it.unitPrice).toFixed(2)} each`,
    )
    .join("\n");
  const thread =
    history
      .filter((m) => m.body)
      .map((m) => `${m.direction === "inbound" ? "Supplier" : "Us"}: ${m.body}`)
      .join("\n") || "(no earlier messages)";
  const newMsg = text.trim() || (hasDoc ? "[sent a document, no caption]" : "");

  const prompt = `Today is ${today} (Asia/Kuala_Lumpur). A document was attached: ${hasDoc ? "YES — most likely their invoice/PoP/photo" : "no"}.

# Open PO ${order.orderNumber} (status ${order.status}) — ${supplier.name}, terms ${supplier.paymentTerms ?? "—"}
# Payment model: ${pm.label}${pm.popDeliveryCritical ? " — PREPAY/DEPOSIT: payment clears BEFORE goods are released, so any payment/PoP message here is delivery-critical; escalate promptly with an honest holding reply." : ""}
${items}

# Recent conversation
${thread}

# New message from the supplier
"${newMsg}"

# Judgement examples (follow this behaviour — natural/casual, but no over-use of bos/emoji)
- "caramel syrup takde" AND Caramel is a line item → po_actions: [remove_item that line]; reply "Ok noted, caramel kita keluarkan dulu, proceed yang lain ya. Bila dijangka ada balik?".
- MULTIPLE lines in one message — "Earl Grey ada 5 je, Peppermint 3, Orange habis" with lines for all three → po_actions: [reduce_qty Earl Grey new_quantity 5, reduce_qty Peppermint new_quantity 3, remove_item Orange]. Resolve ALL of them, one entry per line; do NOT set requires_human just because there are several. Reply confirms each + asks the ETA: "Ok noted, Earl Grey 5, Peppermint 3, Orange kita keluarkan dulu. Bila orange ada balik ya?".
- "ada barang yang takde" (does NOT say which) → po_actions: []; ask "Boleh confirm item mana yang takde ya?".
- "boleh bagi 3 ctn je" for a line of 5 → po_actions: [reduce_qty new_quantity 3]; confirm briefly.
- "hantar Rabu ya" → delivery_date = the next Wednesday's date; po_actions: []; reply "Ok noted, Rabu ya.".
- a document on a PO with no invoice / "ni invois" → capture_invoice true, intent invoice_or_soa, po_actions: []; reply "Ok noted, terima invois. Thank you 🙏" (don't mention the amount).
- "Matcha Morihan OOS, boleh replace Yamama, same quality" → requires_human true, po_actions: [], brief holding reply (do NOT accept the swap).
- "below MOQ RM300, can add something?" → requires_human true, po_actions: [], holding reply.

# Rules
- po_actions = ONE entry per line the supplier flags (reduce_qty / remove_item). Empty [] if nothing changes. Several clear shortfalls is normal — resolve them, don't escalate.
- Whenever you apply a shortfall change, reply_text MUST confirm each adjusted line briefly AND ask when any removed/OOS item comes back. Never a vague "let me check with the team".

# Output — JSON only:
{
  "intent": "out_of_stock|reduce_qty|substitution_offer|price_quote_or_increase|delivery_eta|order_confirmation|invoice_or_soa|payment_gating_or_chase|moq_topup|closure_or_holiday|new_product_offer|reconciliation_query|complaint_or_quality|lead_time_advisory|compliance_or_einvoice|staff_handover|greeting|other|unclear",
  "language": "ms|en|mixed",
  "po_actions": [{"type":"none|remove_item|reduce_qty|substitute_item|cancel_order","po_item_id":null,"new_quantity":null,"note":null}],
  "delivery_date": null,
  "capture_invoice": false,
  "reply_text": "…",
  "confidence": 0.0,
  "requires_human": false,
  "escalation_reason": null
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    system: [
      { type: "text", text: AGENT_ROLE },
      // The playbook is identical every call — cache it.
      { type: "text", text: PLAYBOOK, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const out = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;

  try {
    const p = JSON.parse(m[0]) as Record<string, unknown>;
    const VALID: PoActionType[] = ["none", "remove_item", "reduce_qty", "substitute_item", "cancel_order"];
    const normAction = (raw: unknown): PoAction => {
      const a = (raw ?? {}) as Record<string, unknown>;
      const type = String(a.type ?? "none") as PoActionType;
      return {
        type: VALID.includes(type) ? type : "none",
        po_item_id: typeof a.po_item_id === "string" ? a.po_item_id : null,
        new_quantity: typeof a.new_quantity === "number" ? a.new_quantity : null,
        note: typeof a.note === "string" ? a.note : null,
      };
    };
    // Prefer the new array; fall back to a single po_action if the model returns the
    // old shape. Drop "none" entries so po_actions holds only real line changes.
    const rawList = Array.isArray(p.po_actions) ? p.po_actions : p.po_action != null ? [p.po_action] : [];
    const po_actions = rawList.map(normAction).filter((a) => a.type !== "none");
    return {
      intent: String(p.intent ?? "unclear"),
      language: p.language === "ms" || p.language === "mixed" ? (p.language as "ms" | "mixed") : "en",
      po_actions,
      po_action: po_actions[0] ?? NO_ACTION,
      delivery_date: typeof p.delivery_date === "string" ? p.delivery_date : null,
      capture_invoice: Boolean(p.capture_invoice),
      reply_text: String(p.reply_text ?? ""),
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
      requires_human: Boolean(p.requires_human),
      escalation_reason: typeof p.escalation_reason === "string" ? p.escalation_reason : null,
    };
  } catch {
    return null;
  }
}
