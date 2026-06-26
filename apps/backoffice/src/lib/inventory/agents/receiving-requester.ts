/**
 * Staff GRN chaser — reminds staff to RECEIVE (GRN) a PO that should have arrived
 * but has no receiving recorded. Finds PURCHASE ORDERs that are sent/awaiting,
 * past their delivery date (or 2+ days after they were sent when no date is set),
 * with NO Receiving, and messages the responsible staff to do the goods-receipt
 * in the app — so a delivered order doesn't sit un-received and silently break
 * stock + invoice matching.
 *
 * Cron /api/cron/request-receivings. Gated by PROCUREMENT_AGENT_ENABLED, scoped to
 * allow-listed SUPPLIERS (PROCUREMENT_AGENT_ALLOWLIST) during rollout. Messages the
 * PO creator; set PROCUREMENT_RECEIVING_CHASE_TO to route all chases to one number
 * for testing. Free text inside the 24h window; outside it skipped + logged (a
 * staff-reminder template is the production path). De-duped per PO via
 * raw.receivingChaseFor. Never throws.
 */
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

export const RECEIVING_REQUESTER_VERSION = "receiving-requester-v1";

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

// "Supplier has it / due" but not yet (fully) received. PARTIALLY_RECEIVED already
// has a Receiving, so the `receivings none` filter excludes it anyway.
const DUE_STATUSES: OrderStatus[] = ["SENT", "CONFIRMED", "AWAITING_DELIVERY"];

function enabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}

function allowedSupplier(phone: string | null | undefined): boolean {
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

const firstName = (name: string | null | undefined) => (name || "team").trim().split(/\s+/)[0];

export interface ReceivingRequestSummary {
  scanned: number;
  requested: number;
  skipped: number;
}

export async function runReceivingRequests(): Promise<ReceivingRequestSummary> {
  if (!enabled()) return { scanned: 0, requested: 0, skipped: 0 };

  const now = new Date();
  const staleSentBefore = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      orderType: "PURCHASE_ORDER",
      status: { in: DUE_STATUSES },
      receivings: { none: {} },
      supplier: { phone: { not: null }, status: "ACTIVE" },
      OR: [
        { deliveryDate: { lt: now } },
        { deliveryDate: null, sentAt: { lt: staleSentBefore } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      deliveryDate: true,
      supplier: { select: { name: true, phone: true } },
      outlet: { select: { name: true } },
      createdBy: { select: { name: true, phone: true } },
    },
  });

  let requested = 0;
  let skipped = 0;
  for (const o of orders) {
    if (!o.supplier?.phone || !allowedSupplier(o.supplier.phone)) {
      skipped++;
      continue;
    }
    const ok = await chaseOne(o);
    if (ok) requested++;
    else skipped++;
  }
  return { scanned: orders.length, requested, skipped };
}

type DueOrder = {
  id: string;
  orderNumber: string;
  deliveryDate: Date | null;
  supplier: { name: string; phone: string | null } | null;
  outlet: { name: string } | null;
  createdBy: { name: string | null; phone: string | null } | null;
};

async function chaseOne(o: DueOrder): Promise<boolean> {
  try {
    // Dedupe: already chased this PO?
    const already = await prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", raw: { path: ["receivingChaseFor"], equals: o.id } },
      select: { id: true },
    });
    if (already) return false;

    // Route to the PO creator, or the test override.
    const override = process.env.PROCUREMENT_RECEIVING_CHASE_TO?.trim();
    const dest = digits(override || o.createdBy?.phone);
    if (dest.length < 8) return false; // no usable recipient

    // 24h window with this recipient?
    const lastInbound = await prisma.whatsAppMessage.findFirst({
      where: { fromNumber: dest, direction: "inbound" },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true },
    });
    const windowOpen =
      !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < 24 * 60 * 60 * 1000;

    const name = firstName(o.createdBy?.name);
    const supplierName = o.supplier?.name ?? "supplier";
    const dateStr = o.deliveryDate ? new Date(o.deliveryDate).toISOString().slice(0, 10) : null;
    const text =
      `Hi ${name} 🙏 PO ${o.orderNumber} dari ${supplierName}` +
      `${dateStr ? ` (delivery ${dateStr})` : ""} sepatutnya dah sampai. ` +
      `Dah terima barang? Tolong update receiving/GRN dalam app ya. Terima kasih!`;

    if (!windowOpen) {
      console.log(
        `[receiving-requester] po=${o.orderNumber} skipped — 24h window closed for staff (needs a reminder template)`,
      );
      return false;
    }

    const res = await sendWhatsAppText(dest, text);
    await recordOutboundMessage({
      waMessageId: res.messageId,
      fromNumber: "",
      toNumber: dest,
      type: "text",
      body: text,
      supplierId: null,
      status: res.ok ? "sent" : "failed",
      raw: {
        agent: RECEIVING_REQUESTER_VERSION,
        receivingChaseFor: o.id,
        poNumber: o.orderNumber,
        ok: res.ok,
        error: res.error ?? null,
      },
    });
    console.log(`[receiving-requester] po=${o.orderNumber} staff=${name} sent=${res.ok}`);
    return res.ok;
  } catch (err) {
    console.error("[receiving-requester] error:", err instanceof Error ? err.message : err);
    return false;
  }
}
