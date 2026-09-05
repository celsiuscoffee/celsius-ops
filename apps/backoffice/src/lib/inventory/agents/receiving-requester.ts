/**
 * Staff GRN chaser — reminds staff to RECEIVE (GRN) a PO that should have arrived
 * but has no receiving recorded. Finds PURCHASE ORDERs that are sent/awaiting,
 * past their delivery date (or 2+ days after they were sent when no date is set),
 * with NO Receiving, and messages the responsible staff to do the goods-receipt
 * in the app — so a delivered order doesn't sit un-received and silently break
 * stock + invoice matching.
 *
 * It ALSO chases stuck STOCK TRANSFERS: a transfer sitting in PENDING / APPROVED /
 * IN_TRANSIT for 48h+ is goods that have left one outlet's books and never landed
 * on the other's (102 such transfers were found in prod, 0 ever approved). The
 * destination outlet's MANAGER(s) get the nudge — they are the ones who approve /
 * receive it. Same channel, same format, same dedupe mechanism as the PO chase,
 * but re-chased at most once per 24h (a transfer has no supplier to escalate to,
 * so a single lifetime ping would just be ignored).
 *
 * Cron /api/cron/request-receivings. Gated by PROCUREMENT_AGENT_ENABLED (master
 * switch) + the per-supplier automationMode dial (OFF = hands-off for that
 * supplier's POs) — replaces the retired global PROCUREMENT_AGENT_ALLOWLIST.
 * Messages the PO creator; set PROCUREMENT_RECEIVING_CHASE_TO to route all chases to one number
 * for testing. Free text inside the 24h window; outside it skipped + logged (a
 * staff-reminder template is the production path). De-duped per PO via
 * raw.receivingChaseFor, per transfer via raw.transferChaseFor. Never throws.
 */
import type { OrderStatus, TransferStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

export const RECEIVING_REQUESTER_VERSION = "receiving-requester-v2";

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

// "Supplier has it / due" but not yet (fully) received — including partials,
// whose balance is still outstanding until it lands or a human closes short.
const DUE_STATUSES: OrderStatus[] = ["SENT", "CONFIRMED", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];

// A transfer that has been raised but not landed at the destination.
export const STUCK_TRANSFER_STATUSES: TransferStatus[] = ["PENDING", "APPROVED", "IN_TRANSIT"];
export const TRANSFER_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
export const TRANSFER_RECHASE_AFTER_MS = 24 * 60 * 60 * 1000;

function enabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}

const firstName = (name: string | null | undefined) => (name || "team").trim().split(/\s+/)[0];

export interface ReceivingRequestSummary {
  scanned: number;
  requested: number;
  skipped: number;
  transfersScanned: number;
  transfersRequested: number;
  transfersSkipped: number;
}

export async function runReceivingRequests(): Promise<ReceivingRequestSummary> {
  const empty: ReceivingRequestSummary = {
    scanned: 0, requested: 0, skipped: 0,
    transfersScanned: 0, transfersRequested: 0, transfersSkipped: 0,
  };
  if (!enabled()) return empty;

  const now = new Date();
  const staleSentBefore = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      orderType: "PURCHASE_ORDER",
      status: { in: DUE_STATUSES },
      // Never received at all, OR partially received (has a Receiving but the
      // balance is outstanding) — a short delivery must not stop the chase.
      AND: [
        { OR: [{ receivings: { none: {} } }, { status: "PARTIALLY_RECEIVED" }] },
        {
          OR: [
            { deliveryDate: { lt: now } },
            { deliveryDate: null, sentAt: { lt: staleSentBefore } },
          ],
        },
      ],
      // Per-supplier dial: OFF = the agent stays hands-off for this supplier's POs.
      supplier: { phone: { not: null }, status: "ACTIVE", automationMode: { not: "OFF" } },
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
    if (!o.supplier?.phone) {
      skipped++;
      continue;
    }
    const ok = await chaseOne(o);
    if (ok) requested++;
    else skipped++;
  }

  const transfers = await runTransferChases(now);

  return { scanned: orders.length, requested, skipped, ...transfers };
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
    // Dedupe on SUCCESSFUL chases only — a failed send must not suppress the
    // chase for this PO forever (same rule as every other sender here).
    const already = await prisma.whatsAppMessage.findFirst({
      where: {
        direction: "outbound",
        AND: [
          { raw: { path: ["receivingChaseFor"], equals: o.id } },
          { raw: { path: ["ok"], equals: true } },
        ],
      },
      select: { id: true },
    });
    if (already) return false;

    // Route to the PO creator, or the test override.
    const dest = resolveDest(o.createdBy?.phone);
    if (!dest) return false; // no usable recipient

    const name = firstName(o.createdBy?.name);
    const supplierName = o.supplier?.name ?? "supplier";
    const dateStr = o.deliveryDate ? new Date(o.deliveryDate).toISOString().slice(0, 10) : null;
    const text =
      `Hi ${name} 🙏 PO ${o.orderNumber} dari ${supplierName}` +
      `${dateStr ? ` (delivery ${dateStr})` : ""} sepatutnya dah sampai. ` +
      `Dah terima barang? Tolong update receiving/GRN dalam app ya. Terima kasih!`;

    return await sendStaffChase({
      dest,
      text,
      logTag: `po=${o.orderNumber} staff=${name}`,
      raw: { receivingChaseFor: o.id, poNumber: o.orderNumber },
    });
  } catch (err) {
    console.error("[receiving-requester] error:", err instanceof Error ? err.message : err);
    return false;
  }
}

// ─── Stuck stock transfers ──────────────────────────────────────────────────

type StuckTransfer = {
  id: string;
  status: TransferStatus;
  createdAt: Date;
  fromOutlet: { name: string };
  toOutlet: { id: string; name: string };
  items: { quantity: unknown; product: { name: string }; productPackage: { packageLabel: string } | null }[];
};

async function runTransferChases(now: Date): Promise<{ transfersScanned: number; transfersRequested: number; transfersSkipped: number }> {
  try {
    const transfers = await prisma.stockTransfer.findMany({
      where: {
        status: { in: STUCK_TRANSFER_STATUSES },
        createdAt: { lt: new Date(now.getTime() - TRANSFER_STALE_AFTER_MS) },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        status: true,
        createdAt: true,
        fromOutlet: { select: { name: true } },
        toOutlet: { select: { id: true, name: true } },
        items: {
          take: 5,
          select: { quantity: true, product: { select: { name: true } }, productPackage: { select: { packageLabel: true } } },
        },
      },
    });

    let transfersRequested = 0;
    let transfersSkipped = 0;
    for (const t of transfers) {
      const ok = await chaseTransfer(t, now);
      if (ok) transfersRequested++;
      else transfersSkipped++;
    }
    return { transfersScanned: transfers.length, transfersRequested, transfersSkipped };
  } catch (err) {
    console.error("[receiving-requester] transfer scan error:", err instanceof Error ? err.message : err);
    return { transfersScanned: 0, transfersRequested: 0, transfersSkipped: 0 };
  }
}

/** Active MANAGER(s) of the destination outlet — primary outletId or the multi-outlet list. */
async function destinationManagers(outletId: string): Promise<{ name: string | null; phone: string | null }[]> {
  return prisma.user.findMany({
    where: {
      role: "MANAGER",
      status: "ACTIVE",
      phone: { not: null },
      OR: [{ outletId }, { outletIds: { has: outletId } }],
    },
    select: { name: true, phone: true },
    orderBy: { name: "asc" },
  });
}

async function chaseTransfer(t: StuckTransfer, now: Date): Promise<boolean> {
  try {
    // Idempotent per transfer per 24h: same raw-marker + ok dedupe as the PO
    // path, windowed so a still-stuck transfer gets a daily nudge, not one ever.
    const recent = await prisma.whatsAppMessage.findFirst({
      where: {
        direction: "outbound",
        timestamp: { gte: new Date(now.getTime() - TRANSFER_RECHASE_AFTER_MS) },
        AND: [
          { raw: { path: ["transferChaseFor"], equals: t.id } },
          { raw: { path: ["ok"], equals: true } },
        ],
      },
      select: { id: true },
    });
    if (recent) return false;

    const managers = await destinationManagers(t.toOutlet.id);
    const override = process.env.PROCUREMENT_RECEIVING_CHASE_TO?.trim();
    // One message per stuck transfer: the first manager with a usable number
    // (or the test override). Fan-out to every manager would just be noise.
    const target = override ? { name: managers[0]?.name ?? null, phone: override } : managers.find((m) => digits(m.phone).length >= 8);
    const dest = resolveDest(target?.phone);
    if (!dest) return false;

    const ageDays = Math.floor((now.getTime() - t.createdAt.getTime()) / 86_400_000);
    const action = t.status === "PENDING" ? "approve" : "receive";
    const summary = t.items
      .map((i) => `${Number(i.quantity)} ${i.productPackage?.packageLabel ?? ""} ${i.product.name}`.replace(/\s+/g, " ").trim())
      .join(", ");
    const text =
      `Hi ${firstName(target?.name)} 🙏 Stock transfer dari ${t.fromOutlet.name} ke ${t.toOutlet.name}` +
      ` (${summary || "beberapa item"}) dah ${ageDays} hari status ${t.status}. ` +
      `Barang dah sampai? Tolong ${action} transfer tu dalam app ya supaya stok ${t.toOutlet.name} betul. Terima kasih!`;

    return await sendStaffChase({
      dest,
      text,
      logTag: `transfer=${t.id.slice(0, 8)} to=${t.toOutlet.name} status=${t.status}`,
      raw: { transferChaseFor: t.id, transferStatus: t.status, toOutletId: t.toOutlet.id },
    });
  } catch (err) {
    console.error("[receiving-requester] transfer error:", err instanceof Error ? err.message : err);
    return false;
  }
}

// ─── Shared send path ───────────────────────────────────────────────────────

/** Recipient digits: the test override wins, else the given phone; null when unusable. */
function resolveDest(phone: string | null | undefined): string | null {
  const override = process.env.PROCUREMENT_RECEIVING_CHASE_TO?.trim();
  const dest = digits(override || phone);
  return dest.length >= 8 ? dest : null;
}

/**
 * Send a free-text staff nudge if the 24h WhatsApp window with that recipient is
 * open, and record it with the dedupe marker in `raw`. Returns whether it was
 * actually delivered (the dedupe keys on raw.ok === true).
 */
async function sendStaffChase(opts: { dest: string; text: string; logTag: string; raw: Record<string, unknown> }): Promise<boolean> {
  const { dest, text } = opts;
  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where: { fromNumber: dest, direction: "inbound" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  const windowOpen =
    !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < 24 * 60 * 60 * 1000;

  if (!windowOpen) {
    console.log(`[receiving-requester] ${opts.logTag} skipped — 24h window closed for staff (needs a reminder template)`);
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
      ...opts.raw,
      ok: res.ok,
      error: res.error ?? null,
      ...(res.ok ? {} : { sendFailed: true }),
    },
  });
  console.log(`[receiving-requester] ${opts.logTag} sent=${res.ok}`);
  return res.ok;
}
