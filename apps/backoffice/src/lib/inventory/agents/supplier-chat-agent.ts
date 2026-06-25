/**
 * Supplier-chat AI agent — full-auto procurement conversation handler.
 *
 * On an inbound WhatsApp message from a matched supplier that has an open PO,
 * this reads the message in context (recent thread + the PO's line items),
 * works out what the supplier means (out of stock, reduce qty, price change,
 * delivery update, …) and:
 *   - auto-replies to the supplier in THEIR language (Malay / English / mix), and
 *   - for clear, low-risk cases, edits the open PO itself (remove / reduce a line).
 *
 * Guardrails are enforced in CODE, not left to the model:
 *   - Off unless PROCUREMENT_AGENT_ENABLED=true.
 *   - Only acts for suppliers on PROCUREMENT_AGENT_ALLOWLIST (comma-separated,
 *     matched on the last 8 phone digits) when that var is set — so the first
 *     live run is scoped to the Test supplier, not all suppliers. Unset = all.
 *   - substitutions, full cancellations, and ANY low-confidence call ESCALATE:
 *     we send a safe holding reply and leave the PO untouched for a human.
 *   - every decision is stamped onto the outbound message's `raw` for audit, and
 *     used to de-dupe Meta webhook redeliveries.
 *
 * Sends use sendWhatsAppText, which uses the app's own permanent token server
 * side — no token is needed from a caller. Never throws (callers can await it
 * without risking the webhook's 200).
 *
 * Model: claude-sonnet-4-6 — this edits real POs and writes to real suppliers,
 * so it gets a reasoning-grade model rather than Haiku.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const SUPPLIER_AGENT_VERSION = "supplier-chat-agent-v1";

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

type AgentDecision = {
  intent: string;
  language: "ms" | "en" | "mixed";
  po_action: {
    type: PoActionType;
    po_item_id: string | null;
    new_quantity: number | null;
    note: string | null;
  };
  reply_text: string;
  confidence: number;
  requires_human: boolean;
  escalation_reason: string | null;
};

export interface SupplierMessageEvent {
  fromNumber: string; // supplier's number (digits or +form)
  toNumber: string; // our business number
  text: string;
  waMessageId?: string;
}

const HOLDING_REPLY = {
  ms: "Baik, terima kasih. Saya semak dengan team dulu dan akan maklum balas sebentar lagi. 🙏",
  en: "Noted, thank you — let me confirm with the team and get right back to you. 🙏",
};

function flagEnabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}

// Allow-list of supplier numbers (last-8 digits) the agent may act on. Unset or
// empty => all suppliers. Set to the Test number for the first live run.
function allowed(supplierPhone: string | null | undefined): boolean {
  const raw = process.env.PROCUREMENT_AGENT_ALLOWLIST?.trim();
  if (!raw) return true;
  const tail = digits(supplierPhone).slice(-8);
  if (!tail) return false;
  return raw
    .split(",")
    .map((s) => digits(s).slice(-8))
    .filter(Boolean)
    .includes(tail);
}

/**
 * Entry point. Safe to `await` from the webhook — it never throws and no-ops
 * fast for non-suppliers / disabled flag.
 */
export async function handleSupplierMessage(evt: SupplierMessageEvent): Promise<void> {
  try {
    if (!flagEnabled() || !process.env.ANTHROPIC_API_KEY) return;

    const fromDigits = digits(evt.fromNumber);
    const tail = fromDigits.slice(-8);
    if (tail.length < 8 || !evt.text.trim()) return;

    // Match the supplier by last-8 digits (same rule as whatsapp-store).
    const suppliers = await prisma.supplier.findMany({
      where: { phone: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true, phone: true, paymentTerms: true },
    });
    const supplier = suppliers.find((s) => {
      const sd = digits(s.phone);
      return sd === fromDigits || (sd.length >= 8 && sd.slice(-8) === tail);
    });
    if (!supplier || !allowed(supplier.phone)) return; // unknown / not allow-listed → leave to humans

    // Redelivery dedupe: if we've already auto-answered this exact inbound, stop.
    if (evt.waMessageId) {
      const already = await prisma.whatsAppMessage.findFirst({
        where: { direction: "outbound", raw: { path: ["inReplyTo"], equals: evt.waMessageId } },
        select: { id: true },
      });
      if (already) return;
    }

    // Most recent open PO for this supplier + its line items.
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
        items: {
          select: {
            id: true,
            quantity: true,
            unitPrice: true,
            product: { select: { name: true, baseUom: true } },
          },
        },
      },
    });
    if (!order || order.items.length === 0) return; // nothing actionable

    // Recent thread for context (chronological, last 8).
    const history = await prisma.whatsAppMessage.findMany({
      where: { supplierId: supplier.id },
      orderBy: { timestamp: "desc" },
      take: 8,
      select: { direction: true, body: true },
    });
    history.reverse();

    const decision = await classify(evt.text, supplier, order, history);
    if (!decision) return;

    // ── Guardrails (code, not model): auto-act vs escalate ──
    const risky =
      decision.po_action.type === "substitute_item" || decision.po_action.type === "cancel_order";
    const escalate = decision.requires_human || risky || decision.confidence < 0.7;

    const lang: "ms" | "en" = decision.language === "ms" ? "ms" : "en";
    let replyText = decision.reply_text?.trim();
    let appliedAction: PoActionType = "none";

    if (escalate) {
      // Never confirm an action we're not taking — send a safe holding line.
      replyText = HOLDING_REPLY[lang];
    } else if (
      decision.po_action.type === "remove_item" ||
      decision.po_action.type === "reduce_qty"
    ) {
      appliedAction = await applyPoAction(order.id, decision.po_action);
    }
    if (!replyText) replyText = HOLDING_REPLY[lang];

    // Auto-reply (24h window is open — the supplier just messaged us).
    const sent = await sendWhatsAppText(supplier.phone ?? fromDigits, replyText);

    await recordOutboundMessage({
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
        escalated: escalate,
        escalationReason: escalate ? (decision.escalation_reason ?? "guardrail") : null,
        poNumber: order.orderNumber,
      },
    });

    console.log(
      `[supplier-agent] supplier=${supplier.name} po=${order.orderNumber} intent=${decision.intent} ` +
        `conf=${decision.confidence.toFixed(2)} action=${appliedAction} escalate=${escalate} sent=${sent.ok}`,
    );
  } catch (err) {
    // Never let the agent break the webhook's 200.
    console.error("[supplier-agent] error:", err instanceof Error ? err.message : err);
  }
}

/** Apply a vetted, low-risk edit to the PO and recompute its total. */
async function applyPoAction(
  orderId: string,
  action: AgentDecision["po_action"],
): Promise<PoActionType> {
  if (!action.po_item_id) return "none";
  const item = await prisma.orderItem.findFirst({
    where: { id: action.po_item_id, orderId }, // ensure the line belongs to THIS order
    select: { id: true, unitPrice: true },
  });
  if (!item) return "none";

  if (action.type === "remove_item") {
    await prisma.orderItem.delete({ where: { id: item.id } });
  } else if (action.type === "reduce_qty" && action.new_quantity && action.new_quantity > 0) {
    const q = action.new_quantity;
    await prisma.orderItem.update({
      where: { id: item.id },
      data: { quantity: q, totalPrice: Number(item.unitPrice) * q },
    });
  } else {
    return "none";
  }

  // Recompute the order total from the remaining lines.
  const remaining = await prisma.orderItem.findMany({
    where: { orderId },
    select: { totalPrice: true },
  });
  const total = remaining.reduce((s, i) => s + Number(i.totalPrice), 0);
  await prisma.order.update({ where: { id: orderId }, data: { totalAmount: total } });
  return action.type;
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

const SYSTEM = `You are the procurement assistant for Celsius Coffee, a Malaysian F&B chain. You chat with SUPPLIERS on WhatsApp to manage purchase orders. Suppliers write in Malay, English, or a mix ("Manglish") and often use voice-note-style short text. Reply in the SAME language they use — short, warm, and professional, like a Malaysian operations person. Output ONLY a JSON object, no prose.`;

async function classify(
  text: string,
  supplier: SupplierCtx,
  order: OrderCtx,
  history: Array<{ direction: string; body: string | null }>,
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

  const prompt = `A supplier just messaged us about an open purchase order.

# Supplier
${supplier.name} (payment terms: ${supplier.paymentTerms ?? "—"})

# Open PO ${order.orderNumber} (status ${order.status}) — line items
${items}

# Recent conversation
${thread}

# New message from the supplier
"${text}"

# Decide
Work out what the supplier means and how to respond. Choose a po_action ONLY when it is unambiguous which line item and what change. If the supplier says something is unavailable/short but does NOT say which item, ask which item — do NOT guess.

Rules:
- Out of stock / "takde" / "habis" / "tak dapat" → if the exact item is clear, po_action remove_item with its po_item_id; if it's unclear which, po_action none and ASK which item.
- Less quantity available / "ada sikit je" / "boleh bagi X je" → reduce_qty with new_quantity.
- Offers a different brand / substitute → po_action substitute_item AND requires_human=true (recipe risk; a human must approve).
- Price change, cancelling the whole order, asking for payment/invoice, or anything you are unsure about → requires_human=true, po_action none.
- reply_text: the WhatsApp message to send back, in the supplier's language. If requires_human, keep it to a brief, honest holding acknowledgement — do not promise a specific change.
- Be conservative with confidence: only >0.7 when both the item and the action are unambiguous.

# Output — JSON only:
{
  "intent": "out_of_stock|reduce_qty|substitution_offer|price_change|delivery_update|confirmation|greeting|invoice_request|other|unclear",
  "language": "ms|en|mixed",
  "po_action": {"type":"none|remove_item|reduce_qty|substitute_item|cancel_order","po_item_id": null,"new_quantity": null,"note": null},
  "reply_text": "…",
  "confidence": 0.0,
  "requires_human": false,
  "escalation_reason": null
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    system: SYSTEM,
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
    const pa = (p.po_action ?? {}) as Record<string, unknown>;
    const type = String(pa.type ?? "none") as PoActionType;
    return {
      intent: String(p.intent ?? "unclear"),
      language: p.language === "ms" || p.language === "mixed" ? (p.language as "ms" | "mixed") : "en",
      po_action: {
        type: (
          ["none", "remove_item", "reduce_qty", "substitute_item", "cancel_order"] as PoActionType[]
        ).includes(type)
          ? type
          : "none",
        po_item_id: typeof pa.po_item_id === "string" ? pa.po_item_id : null,
        new_quantity: typeof pa.new_quantity === "number" ? pa.new_quantity : null,
        note: typeof pa.note === "string" ? pa.note : null,
      },
      reply_text: String(p.reply_text ?? ""),
      confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
      requires_human: Boolean(p.requires_human),
      escalation_reason: typeof p.escalation_reason === "string" ? p.escalation_reason : null,
    };
  } catch {
    return null;
  }
}
