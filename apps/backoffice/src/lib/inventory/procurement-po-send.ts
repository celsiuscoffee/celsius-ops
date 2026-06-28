/**
 * Auto-send the PO order block to the supplier when a PO transitions to SENT /
 * AWAITING_DELIVERY. Reuses the EXISTING `formatWhatsAppOrder` 📋 block — the
 * same message staff send by hand via wa.me today — so suppliers see the format
 * they already know.
 *
 * Gated by PROCUREMENT_AGENT_ENABLED + PROCUREMENT_AGENT_ALLOWLIST (scoped to the
 * test supplier for the first live run). De-duped per PO via the outbound row's
 * raw.poSentFor. Free text inside the 24h customer-service window; OUTSIDE it, when
 * PROCUREMENT_PO_PROMPT_TEMPLATE is set we ping the supplier with that approved UTILITY
 * template to invite a reply (which opens the window so the PO block can follow); else the
 * cold send is skipped + logged. Never throws.
 */
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText, sendWhatsAppTemplate } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { formatWhatsAppOrder } from "@celsius/shared";

export const PO_SEND_VERSION = "po-send-v1";

// Cold-send (no 24h window) prompt: a UTILITY template that pings the supplier to reply,
// which opens the window so the full PO block can follow in-window (free). Set this to the
// APPROVED template's name to enable; unset → cold sends skip (as before). The template body
// must be: {{1}} = supplier name, {{2}} = PO number.
const PO_PROMPT_TEMPLATE = process.env.PROCUREMENT_PO_PROMPT_TEMPLATE?.trim();

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

function enabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}

function allowed(phone: string | null | undefined): boolean {
  const raw = process.env.PROCUREMENT_AGENT_ALLOWLIST?.trim();
  if (!raw) return true;
  const tail = digits(phone).slice(-8);
  if (!tail) return false;
  return raw
    .split(",")
    .map((s) => digits(s).slice(-8))
    .filter(Boolean)
    .includes(tail);
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
    if (!supplier?.phone || !allowed(supplier.phone)) return;
    // OFF = the manual lane: these suppliers are ordered from by hand on the Smart Order
    // page (incl. WhatsApp GROUPS via the wa.me picker, which the Cloud API can't reach).
    // Don't also fire a Cloud-API send for them, or they'd get a duplicate 1:1 message.
    if (supplier.automationMode === "OFF") {
      console.log(`[po-send] po=${order.orderNumber} skipped — supplier is OFF (manual / group send)`);
      return;
    }
    const dest = digits(supplier.phone);

    // Dedupe: already sent this PO once?
    const already = await prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", raw: { path: ["poSentFor"], equals: order.id } },
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
      // Cold: WhatsApp blocks free text. Ping with the approved prompt template (if
      // configured) so the supplier replies and opens the window; the full PO block then
      // follows in-window. Deduped via poPromptFor. No template set → skip + log as before.
      if (!PO_PROMPT_TEMPLATE) {
        console.log(`[po-send] po=${order.orderNumber} skipped — 24h window closed, no PROCUREMENT_PO_PROMPT_TEMPLATE`);
        return;
      }
      const alreadyPrompted = await prisma.whatsAppMessage.findFirst({
        where: { direction: "outbound", raw: { path: ["poPromptFor"], equals: order.id } },
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
        body: `New order ${order.orderNumber} — sent a new-order prompt (cold; supplier to reply for the details).`,
        supplierId: supplier.id,
        status: t.ok ? "sent" : "failed",
        raw: {
          agent: PO_SEND_VERSION,
          poPromptFor: order.id,
          poNumber: order.orderNumber,
          via: "template-prompt",
          ok: t.ok,
          error: t.error ?? null,
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
      },
    });

    console.log(`[po-send] po=${order.orderNumber} supplier=${supplier.name} sent=${res.ok}`);
  } catch (err) {
    console.error("[po-send] error:", err instanceof Error ? err.message : err);
  }
}
