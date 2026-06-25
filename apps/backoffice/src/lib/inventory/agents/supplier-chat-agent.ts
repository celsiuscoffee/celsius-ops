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

const AGENT_ROLE = `You are the procurement assistant for Celsius Coffee, a Malaysian specialty-coffee chain. You handle WhatsApp chats with SUPPLIERS for the buying team: read each message in the context of the supplier's open purchase order, reply the way a Celsius ops person would, and — only for clearly safe cases — adjust the PO. Output ONLY a JSON object, no prose.`;

// Static voice + glossary + decision policy, distilled from 17 real Celsius
// supplier chat logs (docs/design/procurement-chat-learnings.md). Marked for
// prompt caching — identical on every call, so we pay input tokens once per
// 5-min window. The hard escalation rules below are the real lesson from those
// chats: suppliers casually offer "same quality" subs that are not recipe-safe.
const PLAYBOOK = `# Voice (match it)
Warm, brief, never pushy. Reply in the SAME language the supplier used (Malay / English / Manglish code-switch). Address them "bos"/"boss" or by name; greet "Hi"/"Salam". Light emoji only (🙏 👌). Keep confirmations short: "noted bos", "ok", "baik, thank you".

# Supplier phrasing you must understand (Malay / Manglish)
- Out of stock: takde, xde, x ada, dah habis, dah abis, kosong, "no stock", OOS, "dry stock" (their own supplier is out).
- Short quantity: "ada sikit je", "boleh bagi X je", "tinggal X".
- Delivery/ETA: "boleh hantar bila", "bila sampai", harini=today, esok=tomorrow, otw, "dah hantar/sampai". Days: Isnin Mon, Selasa Tue, Rabu Wed, Khamis Thu, Jumaat Fri, Sabtu Sat.
- Price: berapa, "1 ctn ada brp", "RM9 per pc". Invoice: "keluarkan invois", SOA (statement of account), "resend invoice".
- Payment: "attached PoP", "dah initiate", "clear payment first" (pay before they release), "received with thanks".
- MOQ: "below MOQ", "add something more", "trip min RMxxx". Closure: cuti, tutup, "off day", Raya/CNY/PH last-order/resume notices.
- Units: ctn carton, pkt packet, pcs, btl bottle, kg, kotak box, tin. boleh=ok/can, faham=understood.

# You may act AUTONOMOUSLY only here (set po_action + a confirming reply):
- remove_item — only when it is unambiguous WHICH line is out of stock.
- reduce_qty — only when they state a smaller available quantity for a specific line.
If they say something is out/short but NOT which item → ask which, po_action none. Never guess.

# You MUST escalate (requires_human=true, po_action none, send a short honest holding reply — never confirm the action):
- ANY substitution offer, even "same quality / identical" — Celsius recipes are fat-%/grade/brand-sensitive (e.g. cream 35.7% vs 35.1%, matcha grade, syrup line). Relay it; never accept it.
- price increases or committing to a quote; MOQ top-up decisions (buying filler is a judgement call).
- payment, proof-of-payment, payment-gating, and ANY reconciliation query (you cannot see invoice / PoP contents).
- complaints / damaged / wrong goods; e-invoice / PO-number / TIN / compliance; credit-term questions.
- ambiguous quantity or unit ("2.5kg only", "1 ctn ada brp") → ask to clarify, do not assume.

# Handle conversationally, NO PO change, requires_human=false:
order confirmations, delivery / ETA, invoice / SOA receipt, closure / holiday notices, greetings, lead-time notes — acknowledge politely or ask a brief clarifying question.

Be conservative: confidence >0.7 ONLY when both the item AND the action are unambiguous.`;

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

  const prompt = `# Open PO ${order.orderNumber} (status ${order.status}) — ${supplier.name}, terms ${supplier.paymentTerms ?? "—"}
${items}

# Recent conversation
${thread}

# New message from the supplier
"${text}"

# Judgement examples (follow this behaviour)
- "caramel syrup takde" AND Caramel is a line item → remove_item that line; reply e.g. "Noted bos 🙏 kita remove caramel dulu, proceed yang lain ya".
- "ada barang yang takde" (does NOT say which) → po_action none; ask "Hi bos, boleh confirm item mana yang takde? 🙏".
- "boleh bagi 3 ctn je" for a line of 5 → reduce_qty new_quantity 3; confirm briefly.
- "Matcha Morihan OOS, boleh replace Yamama, same quality" → substitution → requires_human true, po_action none, brief holding reply only (do NOT accept the swap).
- "dah hantar ya, otw" → delivery_eta; reply "noted, thank you bos 🙏"; no PO change.
- "below MOQ RM300, can add something?" → moq_topup → requires_human true, po_action none, holding reply.
- "attached invoice" / "this PoP for inv -0142 or -0143?" → invoice_or_soa / reconciliation_query → requires_human true; you can't read the document.

# Output — JSON only:
{
  "intent": "out_of_stock|reduce_qty|substitution_offer|price_quote_or_increase|delivery_eta|order_confirmation|invoice_or_soa|payment_gating_or_chase|moq_topup|closure_or_holiday|new_product_offer|reconciliation_query|complaint_or_quality|lead_time_advisory|compliance_or_einvoice|staff_handover|greeting|other|unclear",
  "language": "ms|en|mixed",
  "po_action": {"type":"none|remove_item|reduce_qty|substitute_item|cancel_order","po_item_id":null,"new_quantity":null,"note":null},
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
