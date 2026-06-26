/**
 * Procurement Exec — the accountability loop. See docs/design/procurement-exec-agent.md.
 *
 * The supplier-chat agent is the mouth; this is the brain. It runs on a schedule,
 * assesses the outlets' supply health from existing data, takes the safe actions a
 * good buyer would, and sends ONE concise WhatsApp brief/day to
 * PROCUREMENT_EXEC_NOTIFY_TO — reporting what needs action, not a silent dashboard.
 *
 * Assessed each run:
 *  - NOT OOS         — items at/below reorder point with NO open PO covering them
 *                      (days-to-stockout ranks urgency). With PROCUREMENT_EXEC_AUTO_ORDER
 *                      it opens a capped DRAFT PO to the cheapest supplier (Inc 3).
 *  - NOT OVERPURCHASE / MAX STOCK VALUE — items over max level (with the RM tied up).
 *  - FINANCE         — suppliers with overdue unpaid invoices (they'll gate the next
 *                      delivery / ask COD) → surfaced so finance can settle.
 *  - UNSENT RE-SOURCE — cover POs the agent opened that are still DRAFT.
 *  - OVERDUE GRN     — POs past delivery date with no receiving.
 *
 * Decoupled: reads existing data, touches no agent code + no schema + no migration →
 * doesn't collide with the chat-agent rewrites. Gated by PROCUREMENT_AGENT_ENABLED;
 * de-duped (one brief/day via raw.execBriefDate); never throws. Proactive ordering is
 * DRAFT-only, capped, idempotent, and OFF unless PROCUREMENT_EXEC_AUTO_ORDER=true.
 * Supplier reliability + reply speed (Inc 5) annotate the brief via behaviorTag()
 * (supplier-behavior.ts). Remaining: voice-note (.opus) transcription, scorecard UI.
 */
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { createReorderDraftPO } from "@/lib/inventory/exec/proactive-order";
import { behaviorTag } from "@/lib/inventory/exec/supplier-behavior";
import { runMessageIntel, type IntelSummary } from "@/lib/inventory/exec/message-intel";
import { runIntentResponder, type ResponderSummary } from "@/lib/inventory/exec/intent-responder";

export const EXEC_VERSION = "procurement-exec-v2";

// Mirrors RESOURCE_NOTE_PREFIX in resource-po.ts (kept local so the exec stays
// decoupled from the agent module).
const RESOURCE_NOTE_PREFIX = "Auto re-source by supplier-chat agent";

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");
const DAY = 24 * 60 * 60 * 1000;

const AWAITING_STATUSES: OrderStatus[] = ["SENT", "CONFIRMED", "AWAITING_DELIVERY"];
const OPEN_ORDER_STATUSES: OrderStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "CONFIRMED",
  "AWAITING_DELIVERY",
  "PARTIALLY_RECEIVED",
];

function enabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}
function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface ExecRunSummary {
  oosRisk: number;
  overstock: number;
  financeOverdueSuppliers: number;
  unsentReSource: number;
  overdueGrn: number;
  proactiveOrders: number;
  etaUpdates: number;
  soaToReconcile: number;
  priceIncreases: number;
  openIssues: number;
  vendorPushPrompts: number;
  soaHandoffs: number;
  vendorPushDrafts: number;
  promiseChases: number;
  briefSent: boolean;
  skipped?: string;
}

type OosItem = {
  productId: string;
  productName: string;
  outletId: string;
  outletName: string;
  stock: number;
  days: number;
  neededBase: number;
  headroomBase: number | null;
  shelfUsableBase: number | null;
};
type OverItem = { productName: string; outletName: string; stock: number; maxLevel: number; value: number };
type FinanceItem = { supplierName: string; count: number; outstanding: number };

export async function runProcurementExec(): Promise<ExecRunSummary> {
  const zero: ExecRunSummary = {
    oosRisk: 0,
    overstock: 0,
    financeOverdueSuppliers: 0,
    unsentReSource: 0,
    overdueGrn: 0,
    proactiveOrders: 0,
    etaUpdates: 0,
    soaToReconcile: 0,
    priceIncreases: 0,
    openIssues: 0,
    vendorPushPrompts: 0,
    soaHandoffs: 0,
    vendorPushDrafts: 0,
    promiseChases: 0,
    briefSent: false,
  };
  if (!enabled()) return { ...zero, skipped: "disabled" };

  const now = new Date();
  const agingBefore = new Date(now.getTime() - DAY);

  // Read inbound supplier messages FIRST — applied ETAs update deliveryDate before
  // the overdue-GRN query below reads it — then act on the non-PO intents.
  const intel = await runMessageIntel();
  const responder = await runIntentResponder();

  const [unsent, overdue, supply, finance] = await Promise.all([
    prisma.order.findMany({
      where: {
        orderType: "PURCHASE_ORDER",
        status: "DRAFT",
        notes: { startsWith: RESOURCE_NOTE_PREFIX },
        createdAt: { lt: agingBefore },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        orderNumber: true,
        totalAmount: true,
        supplier: { select: { name: true } },
        outlet: { select: { name: true } },
      },
    }),
    prisma.order.findMany({
      where: {
        orderType: "PURCHASE_ORDER",
        status: { in: AWAITING_STATUSES },
        deliveryDate: { lt: now },
        receivings: { none: {} },
      },
      orderBy: { deliveryDate: "asc" },
      take: 50,
      select: {
        orderNumber: true,
        deliveryDate: true,
        supplier: { select: { name: true } },
        outlet: { select: { name: true } },
      },
    }),
    assessSupply(),
    assessFinance(now),
  ]);

  // ── Inc 3: proactive DRAFT POs for the most urgent OOS-risk (opt-in + capped) ──
  const proactive: string[] = [];
  if (process.env.PROCUREMENT_EXEC_AUTO_ORDER === "true" && supply.oosRisk.length) {
    const systemUser = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } });
    if (systemUser) {
      for (const r of supply.oosRisk.slice(0, 10)) {
        const po = await createReorderDraftPO({
          productId: r.productId,
          productName: r.productName,
          neededBase: r.neededBase,
          headroomBase: r.headroomBase,
          shelfUsableBase: r.shelfUsableBase,
          outletId: r.outletId,
          systemUserId: systemUser.id,
        });
        if (po && !po.existing) proactive.push(`${po.orderNumber}→${po.supplierName}`);
      }
    }
  }

  const summary: ExecRunSummary = {
    oosRisk: supply.oosRisk.length,
    overstock: supply.overstock.length,
    financeOverdueSuppliers: finance.length,
    unsentReSource: unsent.length,
    overdueGrn: overdue.length,
    proactiveOrders: proactive.length,
    etaUpdates: intel.etaUpdates.length,
    soaToReconcile: intel.soa,
    priceIncreases: intel.priceIncrease,
    openIssues: intel.issues,
    vendorPushPrompts: intel.vendorPush,
    soaHandoffs: responder.soaHandoffs,
    vendorPushDrafts: responder.vendorPushDrafts,
    promiseChases: responder.promiseChases,
    briefSent: false,
  };

  const hasAnything =
    supply.oosRisk.length ||
    supply.overstock.length ||
    finance.length ||
    unsent.length ||
    overdue.length ||
    intel.etaUpdates.length ||
    intel.soa ||
    intel.priceIncrease ||
    intel.issues ||
    intel.vendorPush ||
    responder.actions.length ||
    responder.promiseChases;
  if (!hasAnything) return summary;

  const dest = digits(process.env.PROCUREMENT_EXEC_NOTIFY_TO);
  const brief = buildBrief(supply.oosRisk, supply.overstock, finance, unsent, overdue, proactive, intel, responder);
  if (dest.length < 8) {
    console.log(`[procurement-exec] no PROCUREMENT_EXEC_NOTIFY_TO — brief not sent\n${brief}`);
    return summary;
  }

  const today = todayMyt();
  const alreadyToday = await prisma.whatsAppMessage.findFirst({
    where: { direction: "outbound", raw: { path: ["execBriefDate"], equals: today } },
    select: { id: true },
  });
  if (alreadyToday) {
    summary.skipped = "brief-already-sent-today";
    return summary;
  }

  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where: { fromNumber: dest, direction: "inbound" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  const windowOpen = !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < DAY;
  if (!windowOpen) {
    console.log(`[procurement-exec] brief skipped — window closed for ${dest} (needs a template)\n${brief}`);
    summary.skipped = "window-closed";
    return summary;
  }

  const res = await sendWhatsAppText(dest, brief);
  await recordOutboundMessage({
    waMessageId: res.messageId,
    fromNumber: "",
    toNumber: dest,
    type: "text",
    body: brief,
    supplierId: null,
    status: res.ok ? "sent" : "failed",
    raw: {
      agent: EXEC_VERSION,
      execBriefDate: today,
      oosRisk: supply.oosRisk.length,
      overstock: supply.overstock.length,
      financeOverdueSuppliers: finance.length,
      unsentReSource: unsent.length,
      overdueGrn: overdue.length,
      proactiveOrders: proactive.length,
      etaUpdates: intel.etaUpdates.length,
      soaToReconcile: intel.soa,
      priceIncreases: intel.priceIncrease,
      openIssues: intel.issues,
      vendorPushPrompts: intel.vendorPush,
      ok: res.ok,
      error: res.error ?? null,
    },
  });
  summary.briefSent = res.ok;
  console.log(
    `[procurement-exec] brief sent=${res.ok} oos=${supply.oosRisk.length} over=${supply.overstock.length} ` +
      `finance=${finance.length} unsentReSource=${unsent.length} overdueGrn=${overdue.length} proactive=${proactive.length}`,
  );
  return summary;
}

/** OOS-risk (below reorder, no covering PO) + overstock (over max level), per outlet×item. */
async function assessSupply(): Promise<{ oosRisk: OosItem[]; overstock: OverItem[] }> {
  const [pars, stocks, openLines, sps, products, outlets] = await Promise.all([
    prisma.parLevel.findMany({
      select: { productId: true, outletId: true, parLevel: true, reorderPoint: true, maxLevel: true, avgDailyUsage: true },
    }),
    prisma.stockBalance.findMany({ select: { productId: true, outletId: true, quantity: true } }),
    prisma.orderItem.findMany({
      where: { order: { orderType: "PURCHASE_ORDER", status: { in: OPEN_ORDER_STATUSES } } },
      select: { productId: true, order: { select: { outletId: true } } },
    }),
    prisma.supplierProduct.findMany({
      where: { isActive: true, price: { gt: 0 }, supplier: { status: "ACTIVE" } },
      select: { productId: true, price: true, productPackage: { select: { conversionFactor: true } } },
    }),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true, shelfLifeDays: true } }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
  ]);

  const stockMap = new Map<string, number>();
  for (const s of stocks) {
    const k = `${s.productId}_${s.outletId}`;
    stockMap.set(k, (stockMap.get(k) ?? 0) + Number(s.quantity));
  }
  const covered = new Set<string>();
  for (const l of openLines) if (l.order) covered.add(`${l.productId}_${l.order.outletId}`);
  const cheapest = new Map<string, number>();
  for (const sp of sps) {
    const conv = sp.productPackage ? Number(sp.productPackage.conversionFactor) : 1;
    const uc = Number(sp.price) / (conv > 0 ? conv : 1);
    const cur = cheapest.get(sp.productId);
    if (cur === undefined || uc < cur) cheapest.set(sp.productId, uc);
  }
  const prodMap = new Map(products.map((p) => [p.id, p]));
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  const oosRisk: OosItem[] = [];
  const overstock: OverItem[] = [];
  for (const par of pars) {
    const p = prodMap.get(par.productId);
    if (!p) continue;
    const key = `${par.productId}_${par.outletId}`;
    const stock = stockMap.get(key) ?? 0;
    const reorder = Number(par.reorderPoint);
    const parLvl = Number(par.parLevel);
    const maxLvl = par.maxLevel != null ? Number(par.maxLevel) : null;
    const avgDaily = Number(par.avgDailyUsage);
    const outletName = outletMap.get(par.outletId) ?? "?";

    if (stock <= reorder && !covered.has(key) && cheapest.has(par.productId)) {
      const needed = Math.max(parLvl - stock, 0);
      if (needed > 0) {
        oosRisk.push({
          productId: par.productId,
          productName: p.name,
          outletId: par.outletId,
          outletName,
          stock,
          days: avgDaily > 0 ? Math.round(stock / avgDaily) : 999,
          neededBase: needed,
          headroomBase: maxLvl != null ? Math.max(maxLvl - stock, 0) : null,
          shelfUsableBase: p.shelfLifeDays && avgDaily > 0 ? p.shelfLifeDays * avgDaily : null,
        });
      }
    }
    if (maxLvl != null && stock > maxLvl) {
      const uc = cheapest.get(par.productId) ?? 0;
      overstock.push({ productName: p.name, outletName, stock, maxLevel: maxLvl, value: Math.round(stock * uc) });
    }
  }
  oosRisk.sort((a, b) => a.days - b.days);
  overstock.sort((a, b) => b.value - a.value);
  return { oosRisk, overstock };
}

/** Suppliers with overdue, unpaid invoices — outstanding (amount − amountPaid). */
async function assessFinance(now: Date): Promise<FinanceItem[]> {
  const invs = await prisma.invoice.findMany({
    where: {
      status: { notIn: ["PAID", "DRAFT"] },
      dueDate: { lt: now },
      supplierId: { not: null },
    },
    select: { supplierId: true, amount: true, amountPaid: true, supplier: { select: { name: true } } },
  });
  const bySupplier = new Map<string, { name: string; count: number; outstanding: number }>();
  for (const i of invs) {
    if (!i.supplierId) continue;
    const out = Math.max(Number(i.amount) - Number(i.amountPaid ?? 0), 0);
    if (out <= 0) continue;
    const cur = bySupplier.get(i.supplierId) ?? { name: i.supplier?.name ?? "?", count: 0, outstanding: 0 };
    cur.count++;
    cur.outstanding += out;
    bySupplier.set(i.supplierId, cur);
  }
  return [...bySupplier.values()]
    .map((v) => ({ supplierName: v.name, count: v.count, outstanding: Math.round(v.outstanding) }))
    .sort((a, b) => b.outstanding - a.outstanding);
}

function buildBrief(
  oos: OosItem[],
  over: OverItem[],
  finance: FinanceItem[],
  unsent: Array<{ orderNumber: string; supplier: { name: string } | null; outlet: { name: string } | null }>,
  overdue: Array<{ orderNumber: string; deliveryDate: Date | null; supplier: { name: string } | null; outlet: { name: string } | null }>,
  proactive: string[],
  intel: IntelSummary,
  responder: ResponderSummary,
): string {
  const L: string[] = ["🧮 *Procurement status*"];
  if (oos.length) {
    L.push(`\n🔴 ${oos.length} OOS-risk (below reorder, nothing on order):`);
    for (const r of oos.slice(0, 4)) L.push(`• ${r.productName} @ ${r.outletName} — ~${r.days}d left`);
    if (oos.length > 4) L.push(`• …+${oos.length - 4} more`);
    if (proactive.length) L.push(`  → opened ${proactive.length} DRAFT PO${proactive.length > 1 ? "s" : ""} to cover (review + send)`);
  }
  if (over.length) {
    L.push(`\n🟡 ${over.length} overstocked (above max level):`);
    for (const o of over.slice(0, 3)) L.push(`• ${o.productName} @ ${o.outletName} — RM${o.value} tied up`);
    if (over.length > 3) L.push(`• …+${over.length - 3} more`);
  }
  if (finance.length) {
    L.push(`\n💸 ${finance.length} supplier${finance.length > 1 ? "s" : ""} with overdue invoices (finance to settle):`);
    for (const f of finance.slice(0, 3)) L.push(`• ${f.supplierName}${behaviorTag(f.supplierName)} — RM${f.outstanding} (${f.count} inv)`);
    if (finance.length > 3) L.push(`• …+${finance.length - 3} more`);
  }
  if (unsent.length) {
    L.push(`\n⚠️ ${unsent.length} re-source order${unsent.length > 1 ? "s" : ""} still unsent:`);
    for (const o of unsent.slice(0, 3)) L.push(`• ${o.orderNumber} → ${o.supplier?.name ?? "?"}${behaviorTag(o.supplier?.name ?? "")} (${o.outlet?.name ?? "?"})`);
    if (unsent.length > 3) L.push(`• …+${unsent.length - 3} more`);
  }
  if (overdue.length) {
    L.push(`\n📦 ${overdue.length} PO${overdue.length > 1 ? "s" : ""} overdue for receiving:`);
    for (const o of overdue.slice(0, 3)) {
      const d = o.deliveryDate ? new Date(o.deliveryDate).toISOString().slice(0, 10) : "?";
      L.push(`• ${o.orderNumber} — ${o.supplier?.name ?? "?"}${behaviorTag(o.supplier?.name ?? "")}, due ${d}`);
    }
    if (overdue.length > 3) L.push(`• …+${overdue.length - 3} more`);
  }
  if (intel.etaUpdates.length) {
    L.push(`\n🚚 ${intel.etaUpdates.length} delivery ETA${intel.etaUpdates.length > 1 ? "s" : ""} from suppliers:`);
    for (const e of intel.etaUpdates.slice(0, 4)) L.push(`• ${e}`);
    if (intel.etaUpdates.length > 4) L.push(`• …+${intel.etaUpdates.length - 4} more`);
  }
  const finz: string[] = [];
  if (intel.soa) finz.push(`🧾 ${intel.soa} SOA to reconcile`);
  if (intel.priceIncrease) finz.push(`💲 ${intel.priceIncrease} price-increase notice${intel.priceIncrease > 1 ? "s" : ""}`);
  if (intel.issues) finz.push(`🛠 ${intel.issues} issue${intel.issues > 1 ? "s" : ""} (defect/short/wrong)`);
  if (intel.vendorPush) finz.push(`🛒 ${intel.vendorPush} "order this week?" prompt${intel.vendorPush > 1 ? "s" : ""}`);
  if (finz.length) {
    L.push(`\n📨 From supplier chats: ${finz.join(" · ")}`);
  }
  if (responder.actions.length || responder.promiseChases) {
    L.push(`\n🤖 Exec handled:`);
    for (const a of responder.actions.slice(0, 5)) L.push(`• ${a}`);
    if (responder.actions.length > 5) L.push(`• …+${responder.actions.length - 5} more`);
    if (responder.promiseChases) L.push(`• chased ${responder.promiseChases} missed-ETA PO${responder.promiseChases > 1 ? "s" : ""}`);
  }
  return L.join("\n");
}
