/**
 * Proactive invoice requester — the agent CHASES the invoice instead of waiting.
 *
 * For each PURCHASE ORDER that the supplier has confirmed (or that's already in
 * delivery) but has NO invoice attached yet, and that we haven't already asked
 * about, this messages the supplier asking them to issue the invoice — the way a
 * Celsius ops person would ("Hi bos, boleh keluarkan invois untuk order X?").
 *
 * Driven by the /api/cron/request-invoices cron. Same gates as the chat agent:
 * PROCUREMENT_AGENT_ENABLED (master switch) + the per-supplier automationMode
 * dial (OFF = hands-off; ASSIST/AUTO = chase) — replaces the retired global
 * PROCUREMENT_AGENT_ALLOWLIST. Inside an open 24h window it sends free text;
 * otherwise it uses the approved `invoice_request` template (business-initiated).
 * De-duped via the outbound row's raw.invoiceRequestFor on SUCCESSFUL sends only,
 * so a PO is asked at most once but a failed attempt retries on a later cron
 * pass. Never throws.
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

const firstName = (name: string) => (name || "bos").trim().split(/\s+/)[0];

export interface InvoiceRequestSummary {
  scanned: number;
  requested: number;
  skipped: number;
}

export async function runInvoiceRequests(): Promise<InvoiceRequestSummary> {
  if (!enabled()) return { scanned: 0, requested: 0, skipped: 0 };

  // POs confirmed/in-delivery with NO invoice attached yet. RECENT only: old
  // completed POs (pre-dating invoice tracking, or long settled outside the
  // system) are noise to chase — a 12-week-old "boleh keluarkan invois?" reads
  // as a mistake to the supplier and drowns the real asks.
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const candidates = await prisma.order.findMany({
    where: {
      orderType: "PURCHASE_ORDER",
      status: { in: INVOICE_DUE_STATUSES },
      createdAt: { gte: since },
      // Per-supplier dial: OFF = the agent never contacts this supplier.
      supplier: { phone: { not: null }, status: "ACTIVE", automationMode: { not: "OFF" } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      orderNumber: true,
      supplier: { select: { id: true, name: true, phone: true } },
      invoices: { select: { invoiceNumber: true, status: true, dueDate: true } },
    },
  });
  // "Has an invoice" must mean a REAL supplier invoice. The receiving flow and
  // the AWAITING_DELIVERY transition auto-create a GRNI placeholder (INV-####,
  // PENDING, no due date) on nearly every PO — which used to satisfy the old
  // `invoices: none` filter and suppress the chase for practically everything.
  // A placeholder means the invoice is MISSING; those POs are exactly the ones
  // to chase. Real invoices (supplier-numbered, or dated, or paid) stop it.
  const isPlaceholder = (i: { invoiceNumber: string; status: string; dueDate: Date | null }) =>
    i.invoiceNumber.startsWith("INV-") && i.dueDate == null && i.status === "PENDING";
  const orders = candidates.filter((o) => o.invoices.every(isPlaceholder)).slice(0, 100);

  let requested = 0;
  let skipped = 0;
  for (const o of orders) {
    const sup = o.supplier;
    if (!sup?.phone) {
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
    // Dedupe on SUCCESSFUL asks only — a failed send (template not yet approved,
    // transient Meta error) must not mark this PO as chased forever.
    const already = await prisma.whatsAppMessage.findFirst({
      where: {
        direction: "outbound",
        AND: [
          { raw: { path: ["invoiceRequestFor"], equals: orderId } },
          { raw: { path: ["ok"], equals: true } },
        ],
      },
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
    // (fails with #132001 until `invoice_request` is approved — submit it via
    // /api/ops/workspace/templates?action=create). Language code "en" matches how
    // the templates route registers ALL templates (the copy itself is Malay);
    // sending "ms" against an en-registered template is itself a #132001.
    const res = windowOpen
      ? await sendWhatsAppText(dest, text)
      : await sendWhatsAppTemplate(dest, TEMPLATE_NAME, "en", [
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
        // Surfaces the thread in the inbox "needs attention" tab on failure.
        ...(res.ok ? {} : { sendFailed: true }),
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
