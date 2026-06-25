/**
 * Proactive invoice requester — the agent CHASES the invoice instead of waiting.
 *
 * For each PURCHASE ORDER that the supplier has confirmed (or that's already in
 * delivery) but has NO invoice attached yet, and that we haven't already asked
 * about, this messages the supplier asking them to issue the invoice — the way a
 * Celsius ops person would ("Hi bos, boleh keluarkan invois untuk order X?").
 *
 * Driven by the /api/cron/request-invoices cron. Same gates as the chat agent:
 * PROCUREMENT_AGENT_ENABLED + PROCUREMENT_AGENT_ALLOWLIST (so the first live run
 * is scoped to the Test supplier). Inside an open 24h window it sends free text;
 * otherwise it uses the approved `invoice_request` template (business-initiated).
 * De-duped via the outbound row's raw.invoiceRequestFor so a PO is asked at most
 * once. Never throws.
 */
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText, sendWhatsAppTemplate } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

export const INVOICE_REQUESTER_VERSION = "invoice-requester-v1";
const TEMPLATE_NAME = "invoice_request";

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

// Confirmed onward — the supplier has acknowledged the order, so it's fair to ask
// for the invoice. Excludes DRAFT / PENDING_APPROVAL / SENT (too early) and the
// terminal CANCELLED.
const INVOICE_DUE_STATUSES: OrderStatus[] = [
  "CONFIRMED",
  "AWAITING_DELIVERY",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
];

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

const firstName = (name: string) => (name || "bos").trim().split(/\s+/)[0];

export interface InvoiceRequestSummary {
  scanned: number;
  requested: number;
  skipped: number;
}

export async function runInvoiceRequests(): Promise<InvoiceRequestSummary> {
  if (!enabled()) return { scanned: 0, requested: 0, skipped: 0 };

  // POs confirmed/in-delivery with NO invoice attached yet.
  const orders = await prisma.order.findMany({
    where: {
      orderType: "PURCHASE_ORDER",
      status: { in: INVOICE_DUE_STATUSES },
      invoices: { none: {} },
      supplier: { phone: { not: null }, status: "ACTIVE" },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      supplier: { select: { id: true, name: true, phone: true } },
    },
  });

  let requested = 0;
  let skipped = 0;
  for (const o of orders) {
    const sup = o.supplier;
    if (!sup?.phone || !allowed(sup.phone)) {
      skipped++;
      continue;
    }
    const ok = await requestOne(o.id, o.orderNumber, sup.id, sup.name, sup.phone);
    if (ok) requested++;
    else skipped++;
  }
  return { scanned: orders.length, requested, skipped };
}

async function requestOne(
  orderId: string,
  orderNumber: string,
  supplierId: string,
  supplierName: string,
  phone: string,
): Promise<boolean> {
  try {
    // Dedupe: have we already asked for this PO's invoice?
    const already = await prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", raw: { path: ["invoiceRequestFor"], equals: orderId } },
      select: { id: true },
    });
    if (already) return false;

    const dest = digits(phone);

    // 24h customer-service window open? (supplier messaged us in the last 24h)
    const lastInbound = await prisma.whatsAppMessage.findFirst({
      where: { supplierId, direction: "inbound" },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    const windowOpen =
      !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < 24 * 60 * 60 * 1000;

    const text = `Hi ${firstName(supplierName)} 🙏 boleh keluarkan invois untuk order ${orderNumber}? Terima kasih`;

    // Inside the window → free text. Outside → approved business-initiated template
    // (fails gracefully until `invoice_request` is approved in WhatsApp Manager).
    const res = windowOpen
      ? await sendWhatsAppText(dest, text)
      : await sendWhatsAppTemplate(dest, TEMPLATE_NAME, "ms", [
          {
            type: "body",
            parameters: [
              { type: "text", text: firstName(supplierName) },
              { type: "text", text: orderNumber },
            ],
          },
        ]);

    // Resolve our own business number from a recent message so the row threads right.
    const ref = await prisma.whatsAppMessage.findFirst({
      where: { supplierId },
      orderBy: { timestamp: "desc" },
      select: { direction: true, fromNumber: true, toNumber: true },
    });
    const ourNumber = ref ? (ref.direction === "inbound" ? ref.toNumber : ref.fromNumber) : "";

    await recordOutboundMessage({
      waMessageId: res.messageId,
      fromNumber: ourNumber,
      toNumber: dest,
      type: "text",
      body: text,
      supplierId,
      status: res.ok ? "sent" : "failed",
      raw: {
        agent: INVOICE_REQUESTER_VERSION,
        invoiceRequestFor: orderId,
        poNumber: orderNumber,
        via: windowOpen ? "freetext" : "template",
        ok: res.ok,
        error: res.error ?? null,
      },
    });

    console.log(
      `[invoice-requester] po=${orderNumber} supplier=${supplierName} via=${windowOpen ? "freetext" : "template"} sent=${res.ok}`,
    );
    return res.ok;
  } catch (err) {
    console.error("[invoice-requester] error:", err instanceof Error ? err.message : err);
    return false;
  }
}
