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
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { paymentModel, type PaymentModelInfo } from "@/lib/inventory/payment-model";
import { createReSourcePO } from "@/lib/inventory/agents/resource-po";
import { captureInvoice, type InvoiceRevision } from "@/lib/inventory/agents/invoice-capture";
import { verifierEnabled, verifierGateEnabled, verifyMessage, judgePlanned } from "@/lib/inventory/agents/verifier-run";
import { VERIFIER_VERSION } from "@/lib/inventory/agents/verifier";
import { recentQaLessons } from "@/lib/inventory/agents/agent-lessons";

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
  // 1-sentence INTERNAL note for the human reviewer (ASSIST mode) — what the supplier
  // wants, what the agent suggests, any risk to double-check. Never sent to the supplier.
  insight: string;
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
// Payment / finance is never the agent's call — the supplier just needs a short, honest
// "hang on" rather than the agent explaining prepay/deposit mechanics. Used for the
// payment_gating_or_chase intent so the held reply stays casual + non-committal.
const FINANCE_HOLDING_REPLY = {
  ms: "Kejap ya, saya tengah tunggu respon dari team finance.",
  en: "Hang on ya, I'm waiting on a reply from our finance team.",
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
export async function handleSupplierMessage(evt: SupplierMessageEvent): Promise<{ invoiceCaptured: boolean }> {
  try {
    if (!flagEnabled() || !process.env.ANTHROPIC_API_KEY) return { invoiceCaptured: false };

    const hasDoc = evt.type === "document" || evt.type === "image";
    const fromDigits = digits(evt.fromNumber);
    const tail = fromDigits.slice(-8);
    if (tail.length < 8) return { invoiceCaptured: false };
    if (!evt.text.trim() && !hasDoc) return { invoiceCaptured: false }; // nothing to act on

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
    if (!supplier || supplier.automationMode === "OFF") return { invoiceCaptured: false };

    // Redelivery dedupe: if we've already auto-answered this exact inbound, stop.
    if (evt.waMessageId) {
      const already = await prisma.whatsAppMessage.findFirst({
        where: { direction: "outbound", raw: { path: ["inReplyTo"], equals: evt.waMessageId } },
        select: { id: true },
      });
      if (already) return { invoiceCaptured: false };
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
      return { invoiceCaptured: false };
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
    if (!order) return { invoiceCaptured: false }; // no open PO — nothing to act on

    // Recent thread for context (chronological, last 8).
    const history = await prisma.whatsAppMessage.findMany({
      where: { supplierId: supplier.id },
      orderBy: { timestamp: "desc" },
      take: 8,
      select: { direction: true, body: true },
    });
    history.reverse();

    const pm = paymentModel(supplier);
    // Correction memory: recent QA-flagged mistakes, fed back so the agent stops repeating
    // them (no-op string when disabled). Closes the QA loop with the pre-send gate.
    const lessons = await recentQaLessons();
    const decision = await classify(evt.text, supplier, order, history, todayMyt(), hasDoc, pm, lessons);
    if (!decision) return { invoiceCaptured: false };

    // ── Guardrails (code, not model): auto-act vs escalate ──
    // Accountable by default: act on clear shortfalls (reduce/remove every flagged line
    // + re-source each OOS) instead of deferring. Escalate ONLY when the model flags
    // genuine ambiguity (requires_human), a risky swap/cancel, or the supplier is on
    // ASSIST. No confidence-threshold gate — that was escalating clean multi-item
    // shortfalls; the independent verifier backstops every auto-act instead.
    const actions = decision.po_actions.filter((a) => a.type !== "none");
    // Every planned line, name-resolved, for the verifier — so the pre-send gate + post-hoc
    // check judge ALL lines of a multi-item message, not just the primary one.
    const verifierActions = actions.map((a) => ({
      type: a.type,
      itemName: order.items.find((i) => i.id === a.po_item_id)?.product.name ?? null,
      newQuantity: a.new_quantity,
    }));
    const hasRisky = actions.some((a) => a.type === "substitute_item" || a.type === "cancel_order");
    // A "reduce" that doesn't actually LOWER the line (new_qty missing/<=0/>= current) is a
    // model misread — e.g. "ada 50 je" on a line of 5, or echoing a price as a qty. Auto-
    // applying it would silently RAISE committed spend and confirm a cut that didn't happen.
    // Force escalation so it holds with a neutral reply + a human-reviewed proposal instead.
    const badReduce = actions.some((a) => {
      if (a.type !== "reduce_qty") return false;
      const line = order.items.find((i) => i.id === a.po_item_id);
      return !a.new_quantity || a.new_quantity <= 0 || (!!line && a.new_quantity >= Number(line.quantity));
    });
    let escalate = decision.requires_human || hasRisky || badReduce || supplier.automationMode === "ASSIST";
    let qaBlocked = false;
    let gateVerdict: Awaited<ReturnType<typeof judgePlanned>> = null;

    const lang: "ms" | "en" = decision.language === "ms" ? "ms" : "en";
    let replyText = decision.reply_text?.trim();
    let appliedAction: PoActionType = "none";
    const appliedActions: PoActionType[] = [];
    let deliveryUpdated: string | null = null;
    let invoiceCaptured = false;
    let invoiceRevision: InvoiceRevision | null = null;
    type ReSource = { orderId: string; supplierName: string; orderNumber: string; qty: number; unit: string; existing: boolean };
    let reSource: ReSource | null = null;
    const reSources: ReSource[] = [];

    // Capture a supplier-sent invoice as a DRAFT (amount left for a human to verify) —
    // REGARDLESS of escalate/mode. Invoice messages routinely trip requires_human, so
    // when this sat inside the non-escalate branch it was silently skipped while the
    // agent still replied "saved". captureInvoice now matches the invoice to the RIGHT PO
    // (by billed total, not just the most-recent open one) and dedups per-PO itself, so the
    // most-recent-PO `invoices.length` guard is gone — pass the most-recent as the fallback.
    if (decision.capture_invoice) {
      const cap = await captureInvoice(
        { id: order.id, orderNumber: order.orderNumber, outletId: order.outletId, totalAmount: order.totalAmount, status: order.status },
        supplier.id,
        evt.mediaId ?? null,
      );
      invoiceCaptured = cap.captured;
      invoiceRevision = cap.revision;
      // A revised invoice is never auto-applied — force a human gate (ASSIST already escalates;
      // this also holds AUTO suppliers) so it surfaces as an Approve/Reject proposal.
      if (invoiceRevision) escalate = true;
    }

    // Snapshot exactly what the agent saw — used by the pre-send gate now, and recorded
    // for the post-hoc verifier below. Built from pre-apply PO state (the original lines).
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
        .map((m) => ({
          who: (m.direction === "inbound" ? "Supplier" : "Us") as "Supplier" | "Us",
          text: m.body as string,
        })),
      inboundText: evt.text.trim() || (hasDoc ? "[document, no caption]" : ""),
      hadDoc: hasDoc,
      today: todayMyt(),
    };

    // ── Pre-send QA gate ──────────────────────────────────────────
    // Before an AUTO supplier's clean decision actually changes the PO or sends a
    // confirmation, have the independent verifier judge the PLANNED action. A "fail" means
    // don't ship it — flip to escalate (hold + human) instead. This is what turns QA from
    // a post-hoc flag into a real guardrail. Gated (PROCUREMENT_VERIFIER_GATE) + fail-open:
    // a judge error returns null → proceed ungated rather than block the supplier on a hiccup.
    if (!escalate && verifierGateEnabled()) {
      gateVerdict = await judgePlanned(verifierInput, {
        intent: decision.intent,
        language: decision.language,
        actionType: decision.po_action.type,
        actionItemName:
          order.items.find((i) => i.id === decision.po_action.po_item_id)?.product.name ?? null,
        newQuantity: decision.po_action.new_quantity,
        actions: verifierActions,
        deliveryDate: isValidIsoDate(decision.delivery_date) ? decision.delivery_date : null,
        captureInvoice: invoiceCaptured,
        replyText: decision.reply_text?.trim() || "",
        confidence: decision.confidence,
        escalated: false,
        escalationReason: null,
        appliedAction: actions[0]?.type ?? "none",
        reSourced: actions.some((a) => a.type === "remove_item"),
      });
      if (gateVerdict?.rating === "fail") {
        escalate = true;
        qaBlocked = true;
        console.log(
          `[supplier-agent] QA gate BLOCKED auto-act po=${order.orderNumber} — ${gateVerdict.issues?.[0] ?? "fail"}`,
        );
      }
    }

    // The escalation reason shown to the human (and recorded) — name QA explicitly when
    // the gate is what held it, so the inbox reads "qa_gate_blocked" not just "guardrail".
    const escReason = qaBlocked ? "qa_gate_blocked" : decision.escalation_reason ?? "guardrail";

    if (escalate) {
      // Keep the model's OWN holding line — it's specific to this message + varied (the
      // playbook makes it honest + non-committal). Fall back to the canned line only if
      // it came back empty, so we never confirm an action we're not taking.
      replyText = decision.reply_text?.trim() || HOLDING_REPLY[lang];
      // ...except payment/finance: force a short "waiting on finance" line so the agent
      // doesn't free-write a prepay explainer (reads stiff + risks over-promising).
      if (decision.intent === "payment_gating_or_chase") replyText = FINANCE_HOLDING_REPLY[lang];
      // QA gate blocked the planned action — the model's line was written assuming we'd
      // apply it (often a confirmation), so it must NOT go out. Use a neutral holding line.
      if (qaBlocked) replyText = HOLDING_REPLY[lang];
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
          escalationReason: escReason,
          insight: decision.insight?.trim() || "",
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
          // A supplier-sent REVISED invoice → the concrete update for a human to approve
          // (apply-proposal patches the invoice; never touches a PAID one). ASSIST does the work,
          // staff only decides. See assist-mode-principle.
          invoiceAction: invoiceRevision
            ? {
                invoiceId: invoiceRevision.invoiceId,
                invoiceNumber: invoiceRevision.invoiceNumber,
                orderNumber: invoiceRevision.orderNumber,
                fromAmount: invoiceRevision.fromAmount,
                toAmount: invoiceRevision.toAmount,
                fromNumber: invoiceRevision.fromNumber,
                toNumber: invoiceRevision.toNumber,
              }
            : null,
        }
      : null;

    // What the agent actually DID, paired with verifierInput (built earlier) as the
    // post-hoc verifier / Agent QA snapshot.
    const verifierDecision = {
      intent: decision.intent,
      language: decision.language,
      actionType: decision.po_action.type,
      actionItemName:
        order.items.find((i) => i.id === decision.po_action.po_item_id)?.product.name ?? null,
      newQuantity: decision.po_action.new_quantity,
      actions: verifierActions,
      deliveryDate: deliveryUpdated,
      captureInvoice: invoiceCaptured,
      replyText,
      confidence: decision.confidence,
      escalated: escalate,
      escalationReason: escalate ? escReason : null,
      appliedAction,
      reSourced: !!reSource,
    };

    // Auto-reply (24h window is open — the supplier just messaged us).
    // Quote the inbound message so the supplier sees which message we're answering (lost in
    // a merge after #561; restored). evt.waMessageId is the supplier's Meta wamid.
    const sent = await sendWhatsAppText(supplier.phone ?? fromDigits, replyText, evt.waMessageId);

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
        // The send failed — the supplier never got our reply. If a PO edit was applied, the
        // PO is now changed but unconfirmed; the dedup correctly won't retry, so flag the
        // thread for a human to resend (surfaced as needs-attention in the inbox list).
        sendFailed: !sent.ok,
        intent: decision.intent,
        confidence: decision.confidence,
        appliedAction,
        appliedActions,
        deliveryUpdated,
        invoiceCaptured,
        escalated: escalate,
        escalationReason: escalate ? escReason : null,
        qaBlocked,
        poNumber: order.orderNumber,
        paymentModel: pm.model,
        proposal,
        reSource,
        reSources,
        verifierInput,
        verifierDecision,
        // The pre-send gate already judged this exact decision — stamp its verdict so the
        // Agent QA view shows it and the post-hoc verifier skips a redundant call.
        ...(gateVerdict
          ? { verifier: { ...gateVerdict, version: VERIFIER_VERSION, at: new Date().toISOString() } }
          : {}),
      },
    });

    // Close the loop: the independent verifier checks EVERY decision the moment
    // it's made (the reply is already sent, so this never delays the supplier).
    // It only stamps a verdict — a "fail" surfaces the thread as needs-attention
    // in the inbox (see supplier-chats list), pulling a human in exactly when the
    // check catches something. Best-effort, gated, never throws. Skipped when the
    // pre-send gate already judged this decision (its verdict is stamped above).
    if (recordedId && verifierEnabled() && !gateVerdict) {
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
    return { invoiceCaptured };
  } catch (err) {
    // Never let the agent break the webhook's 200.
    console.error("[supplier-agent] error:", err instanceof Error ? err.message : err);
    return { invoiceCaptured: false };
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
  } else if (
    action.type === "reduce_qty" &&
    action.new_quantity &&
    action.new_quantity > 0 &&
    // Defense-in-depth: a reduce must lower the line (the guardrail already escalates a bad
    // reduce, but never let this path raise the order if reached another way).
    action.new_quantity < Number(item.quantity)
  ) {
    const q = action.new_quantity;
    await prisma.orderItem.update({
      where: { id: item.id },
      data: { quantity: q, totalPrice: Number(item.unitPrice) * q },
    });
  } else {
    return { type: "none" };
  }

  // Recompute the order total from the remaining lines (+ keep the delivery charge —
  // dropping it here understated totals and broke the ±2% invoice-total matching).
  const [remaining, order] = await Promise.all([
    prisma.orderItem.findMany({ where: { orderId }, select: { totalPrice: true } }),
    prisma.order.findUnique({ where: { id: orderId }, select: { deliveryCharge: true } }),
  ]);
  const itemsTotal = remaining.reduce((s, i) => s + Number(i.totalPrice), 0);
  const dc = order?.deliveryCharge ? Number(order.deliveryCharge) : 0;
  await prisma.order.update({ where: { id: orderId }, data: { totalAmount: itemsTotal + dc } });
  return { type: action.type, removed };
}

/** Update the PO's delivery date (informational — safe to auto-apply). */
async function applyDeliveryDate(orderId: string, isoDate: string): Promise<void> {
  await prisma.order.update({ where: { id: orderId }, data: { deliveryDate: new Date(isoDate) } });
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
const PLAYBOOK = `# Voice — professional yet casual, like a real Celsius buyer on WhatsApp
Warm and friendly but still professional: never stiff/corporate, but never sloppy or overly slangy either. Clear, polite, brief. Reply in the supplier's language (Malay / English / light Manglish). The ONLY problems are OVERUSING things — keep these in check:
- "bos"/"boss": fine once in a while, NOT on every message and never doubled ("bos bos"). Most replies just skip it.
- Emoji: occasional is fine (a single 🙏 or 👌 now and then), but most replies need NONE. Never one on every message.
- DON'T repeat: never reuse the same sentence, greeting, or sign-off you've already used in this thread. Vary your wording, don't re-greet mid-conversation, don't repeat thank-yous, no filler, never "let me confirm with the team".
- No em-dashes or en-dashes ("—"/"–"); use commas or full stops. Plain WhatsApp text.
- Be specific only when you're CONFIRMING an action you took (name the item/qty/date you changed). For greetings, check-ins ("ada order tak hari ni?"), and small talk, reply with a casual one-liner. Do NOT recite open-PO numbers + item quantities, and do NOT explain our internal situation (payment pending on our side, why goods can't release yet, approvals) unless they actually ask. A buyer answers a casual question casually, not with a status report. Match their energy and length.

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
order confirmations, greetings, "ada order tak hari ni?" check-ins, closure / holiday notices, lead-time notes — a short, warm-but-professional reply (usually one line). Don't dump open-PO numbers/quantities or our payment/approval status; if there's no new order to place, just say so politely (e.g. "belum ada order baru hari ni, nanti saya update kalau ada ya").

Be conservative: confidence >0.7 ONLY when the intended action is unambiguous.`;

async function classify(
  text: string,
  supplier: SupplierCtx,
  order: OrderCtx,
  history: Array<{ direction: string; body: string | null }>,
  today: string,
  hasDoc: boolean,
  pm: PaymentModelInfo,
  lessons = "",
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
- A check-in / greeting ("Hi, ada order tak hari ni?") → po_actions: [], requires_human false; a SHORT, warm-but-professional reply like "Hi! Belum ada order baru hari ni, nanti saya update kalau ada ya. Thanks!" Do NOT list the open PO's number/items or mention our payment status unless they ask.
${lessons}
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
  "escalation_reason": null,
  "insight": "1-sentence INTERNAL note for the human reviewer — what the supplier wants, what you suggest, and any risk to double-check (recipe %, price, payment/PoP). Plain + specific. NOT sent to the supplier."
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
      insight: typeof p.insight === "string" ? p.insight : "",
    };
  } catch {
    return null;
  }
}
