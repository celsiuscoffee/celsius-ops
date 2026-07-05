/**
 * Auto-send the PO order block to the supplier when a PO transitions to SENT /
 * AWAITING_DELIVERY. Reuses the EXISTING `formatWhatsAppOrder` 📋 block — the
 * same message staff send by hand via wa.me today — so suppliers see the format
 * they already know.
 *
 * Gated by PROCUREMENT_AGENT_ENABLED (master switch) + the per-supplier Supplier.automationMode
 * dial: OFF = manual/group lane (skipped + noted here), ASSIST/AUTO = auto-send. (The old global
 * PROCUREMENT_AGENT_ALLOWLIST gate was removed — it shadowed the dial, so an ASSIST supplier was
 * still blocked; automationMode is the real control now.) De-duped per PO via the outbound row's
 * raw.poSentFor on SUCCESSFUL sends only — failures retry on the next trigger.
 * Free text inside the 24h customer-service window; OUTSIDE it, when
 * PROCUREMENT_PO_PROMPT_TEMPLATE is set we ping the supplier with that approved UTILITY
 * template to invite a reply (which opens the window so the PO block can follow); else the
 * cold send is skipped + logged. Never throws.
 */
import { Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText, sendWhatsAppTemplate } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { formatWhatsAppOrder } from "@celsius/shared";
import { generatePoPdf } from "@/lib/inventory/po-pdf";
import { uploadToStorage } from "@/lib/inventory/pdf-splitter";

export const PO_SEND_VERSION = "po-send-v1";

// Cold-send (no 24h window) prompt: a UTILITY template that pings the supplier to reply,
// which opens the window so the full PO block can follow in-window (free). Defaults to the
// procurement_new_order template shipped in TEMPLATE_DEFS (ops/workspace/templates route);
// the env var overrides for testing/renames. The template body must be:
// {{1}} = supplier name, {{2}} = PO number.
const PO_PROMPT_TEMPLATE = process.env.PROCUREMENT_PO_PROMPT_TEMPLATE?.trim() || "procurement_new_order";

// PREFERRED cold path: send the full order as a PDF on an approved DOCUMENT template, so a cold
// supplier gets the whole order in ONE message (no reply-prompt round-trip). Set this to the
// approved template's name to enable; unset → the prompt flow. The template needs a DOCUMENT
// header + a body with {{1}} = supplier name, {{2}} = PO number.
const PO_DOC_TEMPLATE = process.env.PROCUREMENT_PO_DOC_TEMPLATE?.trim();

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

function enabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}

// What we read off the order the PATCH route already loaded (outlet + supplier +
// items.product included). Loose shapes so the caller can pass its richer object.
export interface PoForSend {
  id: string;
  orderNumber: string;
  deliveryDate: Date | null;
  outlet: { name: string; address: string | null };
  supplier: { id: string; name: string; phone: string | null; automationMode?: string | null } | null;
  items: Array<{
    quantity: unknown;
    product: { name: string; baseUom: string } | null;
    productPackage: { packageLabel: string } | null;
  }>;
}

export async function sendPurchaseOrder(order: PoForSend): Promise<void> {
  try {
    if (!enabled()) return;
    const supplier = order.supplier;
    if (!supplier?.phone) return;
    // Fail CLOSED on the automation dial: if the caller's shape didn't carry
    // automationMode, resolve it from the DB rather than assuming it's on.
    const automationMode =
      supplier.automationMode ??
      (
        await prisma.supplier.findUnique({
          where: { id: supplier.id },
          select: { automationMode: true },
        })
      )?.automationMode ??
      "OFF";
    // OFF = the manual lane: these suppliers are ordered from by hand on the Smart Order
    // page (incl. WhatsApp GROUPS via the wa.me picker, which the Cloud API can't reach).
    // Don't also fire a Cloud-API send for them, or they'd get a duplicate 1:1 message.
    // Still leave an internal note in the thread so "PO sent" is visible there —
    // without it the chat shows nothing while the rail lists open POs.
    if (automationMode === "OFF") {
      console.log(`[po-send] po=${order.orderNumber} skipped — supplier is OFF (manual / group send)`);
      await recordPoThreadNote(order, "supplier is on the manual lane (wa.me / group send)");
      return;
    }
    const dest = digits(supplier.phone);

    // Dedupe on SUCCESSFUL sends only — same rule as the prompt path below. A
    // failed block send (token hiccup, Meta 4xx) must not mark the PO delivered
    // forever; the next trigger (status re-save or supplier inbound) retries it.
    const already = await prisma.whatsAppMessage.findFirst({
      where: {
        direction: "outbound",
        AND: [
          { raw: { path: ["poSentFor"], equals: order.id } },
          { raw: { path: ["ok"], equals: true } },
        ],
      },
      select: { id: true },
    });
    if (already) return;

    // 24h window? (supplier messaged us within the last 24h)
    const lastInbound = await prisma.whatsAppMessage.findFirst({
      where: { supplierId: supplier.id, direction: "inbound" },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    const windowOpen =
      !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < 24 * 60 * 60 * 1000;
    if (!windowOpen) {
      // Preferred cold path: send the FULL order as a PDF on an approved DOCUMENT template — the
      // supplier gets the whole order in one message, no "reply for details" round-trip. Returns
      // true when it handled the send (delivered OR a template failure recorded — don't also
      // prompt); false to fall back to the prompt (PDF/upload error).
      if (PO_DOC_TEMPLATE && (await sendPoAsDocument(order, supplier, dest))) return;
      // Fallback cold path: WhatsApp blocks free text, so ping with the approved prompt template
      // (if configured) so the supplier replies and opens the window; the full PO block then
      // follows in-window. Deduped via poPromptFor. No template set → skip + log as before.
      if (!PO_PROMPT_TEMPLATE) {
        console.log(`[po-send] po=${order.orderNumber} skipped — 24h window closed, no PROCUREMENT_PO_PROMPT_TEMPLATE`);
        return;
      }
      // Dedupe on SUCCESSFUL prompts only — a failed send (e.g. the template still
      // pending Meta approval) must not block re-prompting forever, or the PO stays
      // silently undelivered even after the template clears.
      const alreadyPrompted = await prisma.whatsAppMessage.findFirst({
        where: {
          direction: "outbound",
          AND: [
            { raw: { path: ["poPromptFor"], equals: order.id } },
            { raw: { path: ["ok"], equals: true } },
          ],
        },
        select: { id: true },
      });
      if (alreadyPrompted) return;
      const ref = await prisma.whatsAppMessage.findFirst({
        where: { supplierId: supplier.id },
        orderBy: { timestamp: "desc" },
        select: { direction: true, fromNumber: true, toNumber: true },
      });
      const ourNumber = ref ? (ref.direction === "inbound" ? ref.toNumber : ref.fromNumber) : "";
      const t = await sendWhatsAppTemplate(dest, PO_PROMPT_TEMPLATE, "en", [
        {
          type: "body",
          parameters: [
            { type: "text", text: supplier.name },
            { type: "text", text: order.orderNumber },
          ],
        },
      ]);
      await recordOutboundMessage({
        waMessageId: t.messageId,
        fromNumber: ourNumber,
        toNumber: dest,
        type: "text",
        // Record the ACTUAL message the supplier received (the procurement_new_order template
        // body, variables filled) — not an internal status line — so the chat reads like the
        // real conversation. The "sent" status + raw.via mark it as the cold prompt.
        body: `Hi ${supplier.name}, we have prepared a new purchase order ${order.orderNumber} for you. Reply to this message and we will send over the full order details. Thank you.`,
        supplierId: supplier.id,
        status: t.ok ? "sent" : "failed",
        raw: {
          agent: PO_SEND_VERSION,
          poPromptFor: order.id,
          poNumber: order.orderNumber,
          via: "template-prompt",
          ok: t.ok,
          error: t.error ?? null,
          // Surfaces the thread in the inbox "needs attention" tab on failure.
          ...(t.ok ? {} : { sendFailed: true }),
        },
      });
      console.log(`[po-send] po=${order.orderNumber} cold → new-order prompt sent (${PO_PROMPT_TEMPLATE}) ok=${t.ok}`);
      return;
    }

    const message = formatWhatsAppOrder({
      outletName: order.outlet.name,
      orderNumber: order.orderNumber,
      date: new Date().toISOString().slice(0, 10),
      items: order.items
        .filter((it) => it.product)
        .map((it) => ({
          name: it.product!.name,
          quantity: Number(it.quantity),
          // The supplier orders in PACKAGE units (cartons/boxes), so label the line with the
          // package, not the base unit — "3 Box (10× 10pcs Loaf)", not "3 loaf".
          uom: it.productPackage?.packageLabel ?? it.product!.baseUom,
        })),
      deliveryDate: order.deliveryDate
        ? new Date(order.deliveryDate).toISOString().slice(0, 10)
        : undefined,
      address: order.outlet.address ?? undefined,
    });

    const res = await sendWhatsAppText(dest, message);

    // Resolve our own business number from a recent message so the row threads right.
    const ref = await prisma.whatsAppMessage.findFirst({
      where: { supplierId: supplier.id },
      orderBy: { timestamp: "desc" },
      select: { direction: true, fromNumber: true, toNumber: true },
    });
    const ourNumber = ref ? (ref.direction === "inbound" ? ref.toNumber : ref.fromNumber) : "";

    await recordOutboundMessage({
      waMessageId: res.messageId,
      fromNumber: ourNumber,
      toNumber: dest,
      type: "text",
      body: message,
      supplierId: supplier.id,
      status: res.ok ? "sent" : "failed",
      raw: {
        agent: PO_SEND_VERSION,
        poSentFor: order.id,
        poNumber: order.orderNumber,
        via: "freetext",
        ok: res.ok,
        error: res.error ?? null,
        // Surfaces the thread in the inbox "needs attention" tab on failure.
        ...(res.ok ? {} : { sendFailed: true }),
      },
    });

    console.log(`[po-send] po=${order.orderNumber} supplier=${supplier.name} sent=${res.ok}`);
  } catch (err) {
    console.error("[po-send] error:", err instanceof Error ? err.message : err);
  }
}

// Cold-send a PO to the supplier as a PDF attached to an approved document template — the full
// order in ONE message, no reply-prompt. Returns true when the send was handled (delivered OR a
// template failure recorded — caller should NOT also prompt), false to fall back to the prompt
// (PDF generation / upload failed). Deduped via poSentFor. Records the real caption + the PDF as
// mediaUrl so the chat shows the actual message + attachment.
async function sendPoAsDocument(
  order: PoForSend,
  supplier: NonNullable<PoForSend["supplier"]>,
  dest: string,
): Promise<boolean> {
  try {
    // Successful deliveries only — a failed PDF template send must retry on the
    // next trigger instead of counting as delivered forever.
    const already = await prisma.whatsAppMessage.findFirst({
      where: {
        direction: "outbound",
        AND: [
          { raw: { path: ["poSentFor"], equals: order.id } },
          { raw: { path: ["ok"], equals: true } },
        ],
      },
      select: { id: true },
    });
    if (already) return true; // already delivered — don't prompt

    const pdf = await generatePoPdf({
      orderNumber: order.orderNumber,
      outletName: order.outlet.name,
      outletAddress: order.outlet.address,
      date: new Date().toISOString().slice(0, 10),
      deliveryDate: order.deliveryDate ? new Date(order.deliveryDate).toISOString().slice(0, 10) : null,
      items: order.items
        .filter((it) => it.product)
        .map((it) => ({
          name: it.product!.name,
          quantity: Number(it.quantity),
          uom: it.productPackage?.packageLabel ?? it.product!.baseUom,
        })),
    });
    const url = await uploadToStorage(pdf, `po/PO-${order.orderNumber}-${Date.now()}.pdf`, "application/pdf");

    const t = await sendWhatsAppTemplate(dest, PO_DOC_TEMPLATE!, "en", [
      {
        type: "header",
        parameters: [{ type: "document", document: { link: url, filename: `PO-${order.orderNumber}.pdf` } }],
      },
      {
        type: "body",
        parameters: [
          { type: "text", text: supplier.name },
          { type: "text", text: order.orderNumber },
        ],
      },
    ]);

    await recordOutboundMessage({
      waMessageId: t.messageId,
      fromNumber: "",
      toNumber: dest,
      type: "document",
      // The real caption the supplier sees (the doc-template body) — plus the PDF as mediaUrl.
      body: `Hi ${supplier.name}, here's purchase order ${order.orderNumber} from Celsius Coffee. The full order details are attached. Please confirm. Thank you.`,
      mediaUrl: url,
      supplierId: supplier.id,
      status: t.ok ? "sent" : "failed",
      raw: {
        agent: PO_SEND_VERSION,
        poSentFor: order.id,
        poNumber: order.orderNumber,
        via: "pdf-template",
        ok: t.ok,
        error: t.error ?? null,
        ...(t.ok ? {} : { sendFailed: true }),
      },
    });
    console.log(`[po-send] po=${order.orderNumber} cold → PDF document template (${PO_DOC_TEMPLATE}) ok=${t.ok}`);
    return true;
  } catch (e) {
    console.warn(`[po-send] po=${order.orderNumber} PDF send failed, falling back to prompt:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Internal thread note — records "PO sent" in the supplier's chat when the PO
 * went out OUTSIDE the Cloud API (manual lane / wa.me / group, or allowlist
 * skip), so the thread stays the single source of truth. Never sent to the
 * supplier: it's a local whatsAppMessage row with status "note". Deduped per
 * PO via raw.poThreadNote. Cloud-API sends don't need this — the real message
 * row (raw.poSentFor) already shows in the thread.
 */
async function recordPoThreadNote(order: PoForSend, reason: string): Promise<void> {
  try {
    const supplier = order.supplier;
    if (!supplier?.phone) return;
    const dest = digits(supplier.phone);
    const already = await prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", raw: { path: ["poThreadNote"], equals: order.id } },
      select: { id: true },
    });
    if (already) return;
    await recordOutboundMessage({
      waMessageId: undefined,
      fromNumber: "",
      toNumber: dest,
      type: "text",
      body: `📋 PO ${order.orderNumber} marked as sent — ${reason}. (Internal note, not delivered via this chat.)`,
      supplierId: supplier.id,
      status: "note",
      raw: { agent: PO_SEND_VERSION, poThreadNote: order.id, poNumber: order.orderNumber, reason },
    });
  } catch (e) {
    console.warn("[po-send] thread note failed:", e instanceof Error ? e.message : e);
  }
}

const PENDING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Deliver PO blocks that were queued behind a closed 24h window.
 *
 * The cold path sends a template PROMPT (raw.poPromptFor) inviting the supplier
 * to reply; the reply opens the window — and THIS is what then sends the actual
 * PO block. Without it the prompt was a dead end: nothing consumed the reply,
 * so a cold "Create & send" left the PO marked SENT but never delivered.
 *
 * Called from the WhatsApp webhook on every new inbound (best-effort, never
 * throws). Matches the supplier by the same last-8-digits rule as the store,
 * finds their recent POs that got a prompt but no block, and re-runs
 * sendPurchaseOrder — which now sees the window open, sends the block, and
 * stamps raw.poSentFor (its own dedup, so redeliveries are safe).
 */
export async function sendPendingPurchaseOrders(fromNumber: string): Promise<void> {
  try {
    if (!enabled()) return;
    const tail = digits(fromNumber).slice(-8);
    if (tail.length < 8) return;

    // Prisma can't filter on "last 8 digits of a free-text phone" — fetch active
    // suppliers and match in JS (same rule as whatsapp-store).
    const all = await prisma.supplier.findMany({
      where: { phone: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true, phone: true },
    });
    const supplier = all.find((s) => {
      const sd = digits(s.phone);
      return sd.length >= 8 && sd.slice(-8) === tail;
    });
    if (!supplier) return;

    // Prompted-but-undelivered POs for this supplier (recent only).
    const since = new Date(Date.now() - PENDING_LOOKBACK_MS);
    const [prompted, delivered] = await Promise.all([
      prisma.whatsAppMessage.findMany({
        where: {
          direction: "outbound",
          supplierId: supplier.id,
          timestamp: { gte: since },
          raw: { path: ["poPromptFor"], not: Prisma.DbNull },
        },
        select: { raw: true },
      }),
      prisma.whatsAppMessage.findMany({
        where: {
          direction: "outbound",
          supplierId: supplier.id,
          timestamp: { gte: since },
          raw: { path: ["poSentFor"], not: Prisma.DbNull },
        },
        select: { raw: true },
      }),
    ]);
    // Only SUCCESSFUL block sends count as delivered — a failed attempt must
    // leave the PO in the pending set so this inbound retries it.
    const sentIds = new Set(
      delivered
        .filter((m) => (m.raw as Record<string, unknown>)?.ok === true)
        .map((m) => String((m.raw as Record<string, unknown>)?.poSentFor ?? "")),
    );
    const pendingIds = [
      ...new Set(
        prompted
          .map((m) => String((m.raw as Record<string, unknown>)?.poPromptFor ?? ""))
          .filter((id) => id && !sentIds.has(id)),
      ),
    ];
    if (!pendingIds.length) return;

    const orders = await prisma.order.findMany({
      where: { id: { in: pendingIds }, status: { in: ["APPROVED", "SENT", "CONFIRMED", "AWAITING_DELIVERY"] } },
      select: {
        id: true,
        orderNumber: true,
        deliveryDate: true,
        outlet: { select: { name: true, address: true } },
        supplier: { select: { id: true, name: true, phone: true, automationMode: true } },
        items: {
          select: {
            quantity: true,
            product: { select: { name: true, baseUom: true } },
            productPackage: { select: { packageLabel: true } },
          },
        },
      },
    });
    for (const order of orders) {
      await sendPurchaseOrder(order); // window is open now; dedups via poSentFor
    }
    if (orders.length) {
      console.log(`[po-send] window opened by ${supplier.name} — delivered ${orders.length} queued PO block(s)`);
    }
  } catch (err) {
    console.error("[po-send] pending-send error:", err instanceof Error ? err.message : err);
  }
}
