/**
 * Supplier-chat AI agent — ACCOUNTABLE procurement conversation handler.
 *
 * Its job is not "relay the supplier's message" — it's "make sure the outlet gets
 * enough stock." So when a supplier is short/out it RESOLVES the gap instead of
 * bailing to a human:
 *   1. accept what's available (reduce_qty) or drop the OOS line (remove_item) —
 *      for EVERY item the message mentions (multi-item aware),
 *   2. ask the supplier WHEN the rest is back ("bila boleh dapat balik?"),
 *   3. re-source the shortfall (the reduced/removed base qty) to the next-cheapest
 *      alternative supplier — internal only, never told to this supplier,
 *   4. updates the delivery date / captures an invoice doc when relevant,
 *   5. escalates ONLY as a last resort — a substitution offer (recipe risk),
 *      payment/PoP/reconciliation, complaints, price/MOQ commitments, compliance.
 *      NOT for "this message is complex" or moderate uncertainty.
 *
 * Guardrails enforced in CODE: off unless PROCUREMENT_AGENT_ENABLED; allow-listed;
 * it only ever applies reduce/remove itself (substitution/cancel are never applied,
 * even if the model proposes them). Every decision is stamped on the outbound row
 * for audit + the independent verifier. Never throws (safe to await in the webhook).
 *
 * Model: claude-sonnet-4-6.
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
  po_actions: PoAction[]; // one per item the supplier mentions (multi-item aware)
  delivery_date: string | null;
  capture_invoice: boolean;
  reply_text: string;
  confidence: number;
  requires_human: boolean; // genuine last-resort escalation only
  escalation_reason: string | null;
};

export interface SupplierMessageEvent {
  fromNumber: string;
  toNumber: string;
  text: string;
  waMessageId?: string;
  type?: string;
  mediaId?: string | null;
}

const HOLDING_REPLY = {
  ms: "Baik, terima kasih. Saya semak dengan team dulu dan akan maklum balas sebentar lagi. 🙏",
  en: "Noted, thank you — let me confirm with the team and get right back to you. 🙏",
};

function flagEnabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}

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

const isValidIsoDate = (d: string | null): d is string =>
  !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** Today's date in Malaysia (UTC+8), YYYY-MM-DD — so the model can resolve "esok"/"Rabu". */
function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type ReSourceResult = {
  orderId: string;
  supplierName: string;
  orderNumber: string;
  qty: number;
  unit: string;
  existing: boolean;
};

export async function handleSupplierMessage(evt: SupplierMessageEvent): Promise<void> {
  try {
    if (!flagEnabled() || !process.env.ANTHROPIC_API_KEY) return;

    const hasDoc = evt.type === "document" || evt.type === "image";
    const fromDigits = digits(evt.fromNumber);
    const tail = fromDigits.slice(-8);
    if (tail.length < 8) return;
    if (!evt.text.trim() && !hasDoc) return;

    const suppliers = await prisma.supplier.findMany({
      where: { phone: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true, phone: true, paymentTerms: true, depositPercent: true },
    });
    const supplier = suppliers.find((s) => {
      const sd = digits(s.phone);
      return sd === fromDigits || (sd.length >= 8 && sd.slice(-8) === tail);
    });
    if (!supplier || !allowed(supplier.phone)) return;

    if (evt.waMessageId) {
      const already = await prisma.whatsAppMessage.findFirst({
        where: { direction: "outbound", raw: { path: ["inReplyTo"], equals: evt.waMessageId } },
        select: { id: true },
      });
      if (already) return;
    }

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
    if (!order) return;

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

    const lang: "ms" | "en" = decision.language === "ms" ? "ms" : "en";

    // ── Resolve, don't bail. Apply every safe action; re-source each shortfall. ──
    // A substitution/cancellation is the ONLY thing the agent won't apply itself —
    // it flags those for a human while still resolving the rest of the message.
    const appliedActions: string[] = [];
    const reSources: ReSourceResult[] = [];
    let deliveryUpdated: string | null = null;
    let invoiceCaptured = false;
    let needsHuman = decision.requires_human;
    const escalatedActions: PoAction[] = [];

    const systemUser = await prisma.user.findFirst({
      where: { role: "OWNER" },
      select: { id: true },
    });

    for (const action of decision.po_actions) {
      if (action.type === "remove_item" || action.type === "reduce_qty") {
        const result = await applyPoAction(order.id, action);
        if (result.type === "none") continue;
        appliedActions.push(`${result.type}:${result.gap?.productName ?? action.po_item_id}`);
        // Re-source the shortfall (full removed qty, or the reduced-away qty) so the
        // need isn't dropped — internal only; this supplier is never told.
        if (result.gap && result.gap.baseQty > 0 && systemUser) {
          const rs = await createReSourcePO({
            productId: result.gap.productId,
            productName: result.gap.productName,
            baseQtyNeeded: result.gap.baseQty,
            fromSupplierId: supplier.id,
            fromSupplierName: supplier.name,
            outletId: order.outletId,
            systemUserId: systemUser.id,
          });
          if (rs) reSources.push(rs);
        }
      } else if (action.type === "substitute_item" || action.type === "cancel_order") {
        // Recipe-risk / big call — never auto-applied; a human decides.
        needsHuman = true;
        escalatedActions.push(action);
      }
    }

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

    // The model writes the accountable reply (confirm what's accepted + ask the
    // ETA for short items + honestly flag anything a human must decide). We send
    // it as-is — only falling back to a holding line if the model gave nothing AND
    // we did nothing. The CODE, not the reply, is the guarantee a substitution was
    // never applied.
    const didSomething =
      appliedActions.length > 0 || deliveryUpdated !== null || invoiceCaptured;
    let replyText = decision.reply_text?.trim();
    if (!replyText) replyText = didSomething ? "Noted, thank you 🙏" : HOLDING_REPLY[lang];

    // Structured proposal for the inbox when a human must decide (the substitution /
    // cancellation we declined to auto-apply), so staff see a concrete "AI suggests".
    const primaryEsc = escalatedActions[0];
    const proposedItem = primaryEsc?.po_item_id
      ? order.items.find((i) => i.id === primaryEsc.po_item_id)
      : undefined;
    const proposal =
      needsHuman && primaryEsc
        ? {
            intent: decision.intent,
            escalationReason: decision.escalation_reason ?? "needs-human",
            paymentModel: pm.model,
            popDeliveryCritical: pm.popDeliveryCritical,
            orderId: order.id,
            poAction: {
              type: primaryEsc.type,
              poItemId: primaryEsc.po_item_id,
              itemName: proposedItem?.product.name ?? null,
              newQuantity: primaryEsc.new_quantity,
              note: primaryEsc.note,
            },
          }
        : null;

    // Verifier snapshot — keep the established single-action fields populated from
    // the PRIMARY applied/escalated action (backward-compatible) + the full list.
    const primaryAction = decision.po_actions.find((a) => a.type !== "none") ?? null;
    const primaryName = primaryAction?.po_item_id
      ? (order.items.find((i) => i.id === primaryAction.po_item_id)?.product.name ?? null)
      : null;
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
      actionType: primaryAction?.type ?? "none",
      actionItemName: primaryName,
      newQuantity: primaryAction?.new_quantity ?? null,
      actions: decision.po_actions,
      appliedActions,
      appliedAction: appliedActions[0]?.split(":")[0] ?? "none", // backward-compat (Agent QA + verifier)
      deliveryDate: deliveryUpdated,
      captureInvoice: invoiceCaptured,
      replyText,
      confidence: decision.confidence,
      escalated: needsHuman,
      escalationReason: needsHuman ? (decision.escalation_reason ?? "needs-human") : null,
      reSourced: reSources.length > 0,
    };

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
        appliedActions,
        appliedAction: appliedActions[0]?.split(":")[0] ?? "none", // backward-compat (Agent QA + verifier)
        deliveryUpdated,
        invoiceCaptured,
        escalated: needsHuman,
        escalationReason: needsHuman ? (decision.escalation_reason ?? "needs-human") : null,
        poNumber: order.orderNumber,
        paymentModel: pm.model,
        proposal,
        reSource: reSources[0] ?? null,
        reSources,
        verifierInput,
        verifierDecision,
      },
    });

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
        `conf=${decision.confidence.toFixed(2)} applied=[${appliedActions.join(",") || "-"}] ` +
        `delivery=${deliveryUpdated ?? "-"} invoice=${invoiceCaptured} escalate=${needsHuman} ` +
        `reSource=${reSources.map((r) => `${r.orderNumber}->${r.supplierName}(${r.qty})`).join(",") || "-"} sent=${sent.ok}`,
    );
  } catch (err) {
    console.error("[supplier-agent] error:", err instanceof Error ? err.message : err);
  }
}

type GapLine = { productId: string; productName: string; baseQty: number };

/**
 * Apply a vetted, low-risk edit to the PO and recompute its total. Returns the
 * SHORTFALL (base units) so the caller can re-source it — the full line for a
 * removal, the reduced-away amount for a qty cut.
 */
async function applyPoAction(
  orderId: string,
  action: PoAction,
): Promise<{ type: PoActionType; gap?: GapLine }> {
  if (!action.po_item_id) return { type: "none" };
  const item = await prisma.orderItem.findFirst({
    where: { id: action.po_item_id, orderId },
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

  const conv = item.productPackage ? Number(item.productPackage.conversionFactor) : 1;
  const cf = conv > 0 ? conv : 1;
  const oldQty = Number(item.quantity);
  let gap: GapLine | undefined;

  if (action.type === "remove_item") {
    gap = {
      productId: item.productId,
      productName: item.product?.name ?? "item",
      baseQty: oldQty * cf,
    };
    await prisma.orderItem.delete({ where: { id: item.id } });
  } else if (action.type === "reduce_qty" && action.new_quantity != null && action.new_quantity >= 0) {
    const q = action.new_quantity;
    if (q >= oldQty) return { type: "none" }; // not actually a reduction
    if (q === 0) {
      gap = { productId: item.productId, productName: item.product?.name ?? "item", baseQty: oldQty * cf };
      await prisma.orderItem.delete({ where: { id: item.id } });
    } else {
      gap = {
        productId: item.productId,
        productName: item.product?.name ?? "item",
        baseQty: (oldQty - q) * cf, // the shortfall to re-source
      };
      await prisma.orderItem.update({
        where: { id: item.id },
        data: { quantity: q, totalPrice: Number(item.unitPrice) * q },
      });
    }
  } else {
    return { type: "none" };
  }

  const remaining = await prisma.orderItem.findMany({
    where: { orderId },
    select: { totalPrice: true },
  });
  const total = remaining.reduce((s, i) => s + Number(i.totalPrice), 0);
  await prisma.order.update({ where: { id: orderId }, data: { totalAmount: total } });
  return { type: action.type, gap };
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
 * Capture a supplier-sent invoice as a DRAFT invoice on the PO. Reads the document
 * (vision) for the real total/number/dates → AI-prefilled fields; a human still
 * verifies the amount before paying. Falls back to a provisional capture (amount =
 * PO total) if the media can't be read. Always DRAFT → never triggers payment.
 */
async function captureInvoice(
  order: { id: string; orderNumber: string; outletId: string; totalAmount: unknown },
  supplierId: string,
  mediaId: string | null,
): Promise<boolean> {
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
        amount: amount as never,
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
    console.warn("[supplier-agent] invoice capture skipped:", e instanceof Error ? e.message : e);
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
type Prisma_Decimalish = { toString(): string };

const AGENT_ROLE = `You are the procurement coordinator for Celsius Coffee, a Malaysian specialty-coffee chain. You are ACCOUNTABLE for making sure each outlet gets enough stock — you are NOT a messenger. When a supplier is short or out, you resolve it on the spot (accept what they have, ask when the rest is back; we source the gap elsewhere internally), and you only pull in a human as a genuine last resort. Reply like a sharp Malaysian ops person. Output ONLY a JSON object, no prose.`;

const PLAYBOOK = `# Voice (match it)
Warm, brief, decisive, never pushy. Reply in the SAME language the supplier used (Malay / English / Manglish). Address them "bos"/"boss" or by name; greet "Hi"/"Salam". Light emoji only (🙏 👌). Short confirmations: "noted bos", "ok", "baik".

# Supplier phrasing (Malay / Manglish)
- Out of stock: takde, xde, x ada, dah habis, dah abis, kosong, "no stock", OOS, "dry stock".
- Short quantity: "ada sikit je", "boleh bagi X je", "tinggal X", "ada X je".
- Delivery/ETA: "boleh hantar bila", "bila sampai", harini=today, esok=tomorrow, otw, "dah hantar/sampai". Days: Isnin Mon, Selasa Tue, Rabu Wed, Khamis Thu, Jumaat Fri, Sabtu Sat.
- Price: berapa, "RM9 per pc". Invoice: "keluarkan invois", SOA, "resend invoice". Payment: "attached PoP", "clear payment first".
- MOQ: "below MOQ", "add something more". Closure: cuti, tutup, "off day". Units: ctn, pkt, pcs, btl, kg, kotak, tin. boleh=ok.

# Be ACCOUNTABLE for supply — RESOLVE, don't relay
A single message can mention SEVERAL items. Return ONE entry in po_actions PER item, and act on all of them:
- Item OUT of stock ("X takde/habis/kosong") → remove_item for that line.
- Item SHORT ("X ada 5 je", "boleh bagi 3") → reduce_qty with the available number for that line.
- For ANY item you reduce or remove, your reply MUST also ask when it'll be back: e.g. "Earl Grey & Orange bila boleh dapat balik bos? 🙏". (We re-source the shortfall from another supplier automatically — NEVER tell this supplier that.)
- delivery_date → when they state when they'll deliver ("hantar Rabu", "esok") as YYYY-MM-DD vs today. "dah hantar"/"otw" is not a future date.
- capture_invoice → they're sending their invoice/SOA (esp. a document). Acknowledge; don't discuss the amount.
- If they say something's out/short but NOT which item → ask which (no action). Never guess the item.
- reply_text: confirm per item what you accepted + ask the ETA for the short ones, in their language. Do NOT bail to "let me check with the team" when you can resolve it.

# Escalate ONLY as a last resort (requires_human=true)
Set requires_human=true (and DON'T auto-apply) ONLY for:
- a SUBSTITUTION offer, even "same quality" — recipe-sensitive (cream 35.7 vs 35.1). Put it as a substitute_item action and let a human decide; resolve the rest of the message normally.
- payment / PoP / payment-gating / reconciliation; price increase or quote/MOQ commitment; complaint / damaged / wrong goods; e-invoice / TIN / compliance / credit terms.
Do NOT escalate just because a message is long, has many items, or you're moderately unsure — resolve those. Confidence reflects clarity; it does NOT force escalation.

# Conversational, no action (requires_human=false)
order confirmations, greetings, closure/holiday notices, lead-time notes — acknowledge or ask a short clarifying question.`;

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
# Payment model: ${pm.label}${pm.popDeliveryCritical ? " — PREPAY/DEPOSIT: payment clears BEFORE goods are released, so any payment/PoP message is delivery-critical → escalate promptly." : ""}
${items}

# Recent conversation
${thread}

# New message from the supplier
"${newMsg}"

# Judgement examples
- "Earl Grey not enough, ada 5 je. Peppermint ada 3. Orange habis" → po_actions: [reduce_qty Earl Grey→5, reduce_qty Peppermint→3, remove_item Orange]; reply confirms all three + asks "Earl Grey, Peppermint & Orange bila boleh restock bos? 🙏". requires_human=false.
- "caramel syrup takde" → po_actions:[remove_item Caramel]; reply "Noted bos 🙏 kita remove caramel dulu — bila boleh dapat balik ya?".
- "ada barang takde" (not said which) → po_actions:[]; ask which item.
- "hantar Rabu ya" → delivery_date next Wednesday; brief confirm.
- a document / "ni invois" → capture_invoice true; "terima invois 🙏" (no amount).
- "Matcha Morihan OOS, boleh replace Yamama same quality" → po_actions:[substitute_item Matcha], requires_human true; reply resolves any other items + says you'll confirm the replacement with the team.

# Output — JSON only:
{
  "intent": "out_of_stock|reduce_qty|substitution_offer|price_quote_or_increase|delivery_eta|order_confirmation|invoice_or_soa|payment_gating_or_chase|moq_topup|closure_or_holiday|new_product_offer|reconciliation_query|complaint_or_quality|lead_time_advisory|compliance_or_einvoice|staff_handover|greeting|other|unclear",
  "language": "ms|en|mixed",
  "po_actions": [{"type":"remove_item|reduce_qty|substitute_item|cancel_order","po_item_id":"…","new_quantity":null,"note":null}],
  "delivery_date": null,
  "capture_invoice": false,
  "reply_text": "…",
  "confidence": 0.0,
  "requires_human": false,
  "escalation_reason": null
}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 900,
    system: [
      { type: "text", text: AGENT_ROLE },
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

  const ALLOWED: PoActionType[] = ["none", "remove_item", "reduce_qty", "substitute_item", "cancel_order"];
  try {
    const p = JSON.parse(m[0]) as Record<string, unknown>;
    const rawActions = Array.isArray(p.po_actions) ? p.po_actions : [];
    const po_actions: PoAction[] = rawActions
      .map((a): PoAction => {
        const o = (a ?? {}) as Record<string, unknown>;
        const type = String(o.type ?? "none") as PoActionType;
        return {
          type: ALLOWED.includes(type) ? type : "none",
          po_item_id: typeof o.po_item_id === "string" ? o.po_item_id : null,
          new_quantity: typeof o.new_quantity === "number" ? o.new_quantity : null,
          note: typeof o.note === "string" ? o.note : null,
        };
      })
      .filter((a) => a.type !== "none");
    return {
      intent: String(p.intent ?? "unclear"),
      language: p.language === "ms" || p.language === "mixed" ? (p.language as "ms" | "mixed") : "en",
      po_actions,
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
