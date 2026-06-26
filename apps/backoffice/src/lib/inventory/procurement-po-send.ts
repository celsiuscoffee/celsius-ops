/**
 * Auto-send the PO order block to the supplier when a PO transitions to SENT /
 * AWAITING_DELIVERY. Reuses the EXISTING `formatWhatsAppOrder` 📋 block — the
 * same message staff send by hand via wa.me today — so suppliers see the format
 * they already know.
 *
 * Gated by PROCUREMENT_AGENT_ENABLED + PROCUREMENT_AGENT_ALLOWLIST (scoped to the
 * test supplier for the first live run). De-duped per PO via the outbound row's
 * raw.poSentFor. Free text inside the 24h customer-service window; OUTSIDE it the
 * send is skipped + logged — a business-initiated `purchase_order` template is the
 * production path for cold sends and isn't wired here yet. Never throws.
 */
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { formatWhatsAppOrder } from "@celsius/shared";

export const PO_SEND_VERSION = "po-send-v1";

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
  supplier: { id: string; name: string; phone: string | null } | null;
  items: Array<{ quantity: unknown; product: { name: string; baseUom: string } | null }>;
}

export async function sendPurchaseOrder(order: PoForSend): Promise<void> {
  try {
    if (!enabled()) return;
    const supplier = order.supplier;
    if (!supplier?.phone || !allowed(supplier.phone)) return;
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
      console.log(
        `[po-send] po=${order.orderNumber} skipped — 24h window closed (cold send needs the purchase_order template)`,
      );
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
          uom: it.product!.baseUom,
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
