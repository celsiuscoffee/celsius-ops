/**
 * Intent responder (Inc 5) — acts on the supplier intents the chat agent does NOT
 * touch. The agent (supplier-chat-agent.ts) bails when there's no open PO
 * (`if (!order) return`), so SOA / vendor-push / price / invoice-revise messages fall
 * straight through. This picks them up → NO double-reply, NO agent edit, NO collision.
 *
 * Handlers (reads message-intel's raw.intel classification):
 *  - SOA → reconcile vs our unpaid invoices → hand the OUTSTANDING to finance
 *    (PROCUREMENT_FINANCE_NOTIFY_TO). Internal handoff; payment is SOA-based here.
 *  - vendor-push ("any order this week?") → compute that supplier's below-reorder
 *    lines → draft the week's order back to them.
 *  - delivery promise missed → a promised date passed with no GRN → chase for an ETA.
 *  - price-increase / invoice-revise → flag for review (surfaced in the brief).
 *
 * Supplier-facing sends go out only for AUTO suppliers (the per-supplier dial,
 * Supplier.automationMode); ASSIST/OFF → the draft is surfaced in the brief for the
 * inbox. The internal finance handoff sends whenever PROCUREMENT_FINANCE_NOTIFY_TO is
 * set + in-window. Gated by PROCUREMENT_AGENT_ENABLED; de-duped via raw markers; never
 * throws. See procurement-supplier-chat-intelligence.md.
 */
import type { OrderStatus, Prisma } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { outletConfirmEnabled, readOutletDeliveryState, askOutletIfArrived } from "./outlet-delivery-check";

const DAY = 24 * 60 * 60 * 1000;
const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");
const AWAITING_STATUSES: OrderStatus[] = ["SENT", "CONFIRMED", "AWAITING_DELIVERY"];

function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
async function windowOpen(phone: string): Promise<boolean> {
  const last = await prisma.whatsAppMessage.findFirst({
    where: { fromNumber: digits(phone), direction: "inbound" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  return !!last && Date.now() - +new Date(last.timestamp) < DAY;
}

export interface ResponderSummary {
  soaHandoffs: number;
  vendorPushDrafts: number;
  promiseChases: number;
  flagged: number;
  actions: string[]; // human-readable, for the brief
  skipped?: string;
}
const EMPTY: ResponderSummary = { soaHandoffs: 0, vendorPushDrafts: 0, promiseChases: 0, flagged: 0, actions: [] };

export async function runIntentResponder(): Promise<ResponderSummary> {
  if (process.env.PROCUREMENT_AGENT_ENABLED !== "true") return { ...EMPTY, skipped: "disabled" };
  // Supplier-facing replies send only for AUTO suppliers (the per-supplier dial);
  // ASSIST/OFF → drafted/surfaced. The internal finance handoff is unaffected.
  const financeDest = digits(process.env.PROCUREMENT_FINANCE_NOTIFY_TO);
  const today = todayMyt();
  const out: ResponderSummary = { ...EMPTY, actions: [] };

  // Inbound supplier messages classified by message-intel that we haven't acted on.
  const since = new Date(Date.now() - 7 * DAY);
  const recent = await prisma.whatsAppMessage.findMany({
    where: { direction: "inbound", supplierId: { not: null }, timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
    select: { id: true, supplierId: true, fromNumber: true, raw: true },
    take: 1000,
  });

  // Latest actionable message per (supplier, category) — don't double-handle.
  type Job = { supplierId: string; phone: string; messageId: string; category: string };
  const seen = new Set<string>();
  const jobs: Job[] = [];
  for (const m of recent) {
    const raw = (m.raw && typeof m.raw === "object" ? (m.raw as Record<string, unknown>) : {}) as Record<string, unknown>;
    const intel = raw.intel as { category?: string; responded?: boolean } | undefined;
    const cat = intel?.category;
    if (!cat || intel?.responded) continue;
    if (!["soa", "vendorpush", "price", "invchange"].includes(cat)) continue;
    const k = `${m.supplierId}:${cat}`;
    if (seen.has(k)) continue;
    seen.add(k);
    jobs.push({ supplierId: m.supplierId!, phone: m.fromNumber, messageId: m.id, category: cat });
  }

  for (const job of jobs) {
    const supplier = await prisma.supplier.findUnique({ where: { id: job.supplierId }, select: { name: true, phone: true, automationMode: true } });
    if (!supplier) continue;
    const name = supplier.name;
    try {
      if (job.category === "soa") {
        const r = await handleSoa(job.supplierId, name, financeDest, today);
        if (r) {
          out.soaHandoffs++;
          out.actions.push(`🧾 SOA ${name}: RM${r.outstanding.toFixed(0)} outstanding (${r.count} inv) → finance${r.sent ? " ✅" : ""}`);
        }
      } else if (job.category === "vendorpush") {
        const draft = await draftWeeklyOrder(job.supplierId, name);
        if (draft) {
          out.vendorPushDrafts++;
          const sent = supplier.automationMode === "AUTO" && (await maybeSendToSupplier(job.phone, draft));
          out.actions.push(`🛒 ${name} asked for an order — ${sent ? "replied" : "draft ready"}: ${draft.slice(0, 60)}…`);
        }
      } else if (job.category === "price" || job.category === "invchange") {
        out.flagged++;
        out.actions.push(`${job.category === "price" ? "💲 price-change" : "📝 invoice/CN"} from ${name} — review`);
      }
    } catch (e) {
      console.warn(`[intent-responder] ${job.category} for ${name} failed:`, e instanceof Error ? e.message : e);
    }
    await markResponded(job.messageId);
  }

  // Delivery promise missed → chase for a fresh ETA (AUTO suppliers only).
  out.promiseChases = await chaseMissedPromises();

  console.log(
    `[intent-responder] soa=${out.soaHandoffs} vendorPush=${out.vendorPushDrafts} chases=${out.promiseChases} flagged=${out.flagged}`,
  );
  return out;
}

/** SOA → reconcile vs unpaid invoices → hand outstanding to finance. One/supplier/day. */
async function handleSoa(
  supplierId: string,
  name: string,
  financeDest: string,
  today: string,
): Promise<{ outstanding: number; count: number; sent: boolean } | null> {
  const key = `${supplierId}:${today}`;
  const dupe = await prisma.whatsAppMessage.findFirst({
    where: { direction: "outbound", raw: { path: ["soaHandoffFor"], equals: key } },
    select: { id: true },
  });
  if (dupe) return null;

  const invs = await prisma.invoice.findMany({
    where: { supplierId, status: { notIn: ["PAID", "DRAFT"] } },
    orderBy: { dueDate: "asc" },
    select: { invoiceNumber: true, amount: true, amountPaid: true, dueDate: true },
  });
  let outstanding = 0;
  const lines: string[] = [];
  for (const i of invs) {
    const o = Number(i.amount) - Number(i.amountPaid ?? 0);
    if (o > 0.005) {
      outstanding += o;
      lines.push(`${i.invoiceNumber}: RM${o.toFixed(2)}`);
    }
  }
  if (outstanding <= 0) return null;

  const text =
    `📊 *SOA received — ${name}*\nOur records: RM${outstanding.toFixed(2)} outstanding across ${lines.length} invoice(s):\n` +
    lines.slice(0, 8).map((l) => `• ${l}`).join("\n") +
    (lines.length > 8 ? `\n• …+${lines.length - 8} more` : "") +
    `\nReconcile vs their SOA + settle.`;

  let sent = false;
  if (financeDest.length >= 8 && (await windowOpen(financeDest))) {
    const res = await sendWhatsAppText(financeDest, text);
    await recordOutboundMessage({
      waMessageId: res.messageId,
      fromNumber: "",
      toNumber: financeDest,
      type: "text",
      body: text,
      supplierId: null,
      status: res.ok ? "sent" : "failed",
      raw: { agent: "intent-responder", soaHandoffFor: key, outstanding, ok: res.ok, error: res.error ?? null },
    });
    sent = res.ok;
  } else {
    console.log(`[intent-responder] SOA handoff (no finance dest / window) for ${name}:\n${text}`);
  }
  return { outstanding, count: lines.length, sent };
}

/**
 * Draft the week's order for a supplier that asked — their below-reorder lines,
 * in the PACKAGE units the supplier sells (never bare base-unit numbers: a
 * shortfall of 22,000 ml must read "22 Bottle (1000ml)", not "22000"). Skips
 * outlet lines already covered by an open PO so we don't double-order.
 */
async function draftWeeklyOrder(supplierId: string, name: string): Promise<string | null> {
  const sps = await prisma.supplierProduct.findMany({
    where: { supplierId, isActive: true },
    select: {
      productId: true,
      product: { select: { name: true, baseUom: true } },
      productPackage: { select: { conversionFactor: true, packageLabel: true } },
    },
  });
  if (!sps.length) return null;
  const productIds = sps.map((s) => s.productId);
  const spById = new Map(sps.map((s) => [s.productId, s]));

  const [pars, stocks, openLines] = await Promise.all([
    prisma.parLevel.findMany({ where: { productId: { in: productIds } }, select: { productId: true, outletId: true, reorderPoint: true, parLevel: true } }),
    prisma.stockBalance.findMany({ where: { productId: { in: productIds } }, select: { productId: true, outletId: true, quantity: true } }),
    // Lines already on an open PO (any supplier) — same coverage rule as the exec's
    // OOS check, so the draft never re-orders what's already coming.
    prisma.orderItem.findMany({
      where: {
        productId: { in: productIds },
        order: { orderType: "PURCHASE_ORDER", status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", ...AWAITING_STATUSES, "PARTIALLY_RECEIVED"] as OrderStatus[] } },
      },
      select: { productId: true, order: { select: { outletId: true } } },
    }),
  ]);
  const stockMap = new Map<string, number>();
  for (const s of stocks) {
    const k = `${s.productId}_${s.outletId}`;
    stockMap.set(k, (stockMap.get(k) ?? 0) + Number(s.quantity));
  }
  const covered = new Set<string>();
  for (const l of openLines) if (l.order) covered.add(`${l.productId}_${l.order.outletId}`);

  // Aggregate the shortfall per product across outlets (base units).
  const need = new Map<string, number>();
  for (const p of pars) {
    const k = `${p.productId}_${p.outletId}`;
    if (covered.has(k)) continue;
    const stock = stockMap.get(k) ?? 0;
    if (stock <= Number(p.reorderPoint)) {
      const short = Math.max(Number(p.parLevel) - stock, 0);
      if (short > 0) need.set(p.productId, (need.get(p.productId) ?? 0) + short);
    }
  }
  if (!need.size) {
    return `Hi ${name}, thanks! Nothing needed this week 🙏`;
  }
  const items = [...need.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pid, baseQty]) => {
      const sp = spById.get(pid);
      const convRaw = sp?.productPackage ? Number(sp.productPackage.conversionFactor) : 1;
      const conv = convRaw > 0 ? convRaw : 1;
      const pkgQty = Math.max(1, Math.ceil(baseQty / conv));
      const unit = sp?.productPackage?.packageLabel ?? sp?.product?.baseUom ?? "unit";
      return `• ${sp?.product?.name ?? "?"} — ${pkgQty} ${unit}`;
    });
  return `Hi ${name}, yes please — boleh prepare:\n${items.join("\n")}\nThank you! 🙏`;
}

async function maybeSendToSupplier(phone: string, text: string): Promise<boolean> {
  const dest = digits(phone);
  if (dest.length < 8 || !(await windowOpen(dest))) return false;
  const res = await sendWhatsAppText(dest, text);
  await recordOutboundMessage({
    waMessageId: res.messageId,
    fromNumber: "",
    toNumber: dest,
    type: "text",
    body: text,
    supplierId: null,
    status: res.ok ? "sent" : "failed",
    raw: { agent: "intent-responder", autoReply: true, ok: res.ok, error: res.error ?? null },
  });
  return res.ok;
}

/** POs whose promised delivery date has passed with no GRN → chase for a fresh ETA. */
async function chaseMissedPromises(): Promise<number> {
  const now = new Date();
  // Only chase a RECENTLY-overdue delivery. A PO weeks past its date with still no GRN is almost
  // always a missing-receiving (ops didn't record the goods), NOT a late delivery — chasing the
  // supplier for a "new ETA" on a 6-week-old PO is wrong and looks disorganised. Beyond this
  // window it's left for ops to reconcile (the goods likely arrived and just need receiving).
  const CHASE_MAX_OVERDUE_DAYS = 7;
  const chaseFloor = new Date(now.getTime() - CHASE_MAX_OVERDUE_DAYS * 24 * 60 * 60 * 1000);
  const overdue = await prisma.order.findMany({
    where: {
      orderType: "PURCHASE_ORDER",
      status: { in: AWAITING_STATUSES },
      deliveryDate: { lt: now, gte: chaseFloor },
      receivings: { none: {} },
    },
    take: 30,
    select: { id: true, orderNumber: true, deliveryDate: true, outletId: true, supplier: { select: { name: true, phone: true, automationMode: true } } },
  });
  let chased = 0;
  for (const o of overdue) {
    if (!o.supplier?.phone) continue;
    const dupe = await prisma.whatsAppMessage.findFirst({
      where: { direction: "outbound", raw: { path: ["promiseChaseFor"], equals: o.id } },
      select: { id: true },
    });
    if (dupe) continue;
    const dest = digits(o.supplier.phone);
    const text = `Hi ${o.supplier.name}, following up on ${o.orderNumber} — expected ${o.deliveryDate ? new Date(o.deliveryDate).toISOString().slice(0, 10) : "earlier"} but not received yet. New ETA? 🙏`;
    if (o.supplier.automationMode === "AUTO" && dest.length >= 8 && (await windowOpen(dest))) {
      // Confirm with the on-shift OUTLET team BEFORE chasing the supplier — a missing GRN is
      // as often an un-recorded receiving as a real non-delivery (don't chase the supplier for
      // an ops gap). Gated for safe rollout; off → chases directly as before.
      if (outletConfirmEnabled() && o.outletId) {
        const state = await readOutletDeliveryState(o.id);
        // arrived → never chase (outlet confirmed it came); pending → still waiting (within grace).
        if (state === "arrived" || state === "pending") continue;
        if (state === "unasked") {
          const ask = await askOutletIfArrived({
            id: o.id,
            orderNumber: o.orderNumber,
            outletId: o.outletId,
            supplierName: o.supplier.name,
            deliveryDate: o.deliveryDate,
          });
          if (ask === "asked") continue; // wait for the outlet's reply (or grace) before chasing
          // no on-shift team / couldn't deliver → fall through and chase now, don't block.
        }
        // "not_arrived" (outlet confirmed it didn't come) | "stale" (no reply past grace) → chase.
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
        raw: { agent: "intent-responder", promiseChaseFor: o.id, ok: res.ok, error: res.error ?? null },
      });
      if (res.ok) chased++;
    } else {
      console.log(`[intent-responder] promise-chase draft for ${o.orderNumber}:\n${text}`);
    }
  }
  return chased;
}

async function markResponded(messageId: string): Promise<void> {
  const m = await prisma.whatsAppMessage.findUnique({ where: { id: messageId }, select: { raw: true } });
  const raw = (m?.raw && typeof m.raw === "object" ? (m.raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const intel = (raw.intel && typeof raw.intel === "object" ? (raw.intel as Record<string, unknown>) : {}) as Record<string, unknown>;
  await prisma.whatsAppMessage.update({
    where: { id: messageId },
    data: { raw: { ...raw, intel: { ...intel, responded: true } } as Prisma.InputJsonValue },
  });
}
