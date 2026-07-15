// Purchasing Manager agent — the procurement watchdog.
//
// A new agent in the finance/procurement agent family. It is ADVISORY: it
// never blocks a PO or moves money, it detects and flags, logging every
// finding to fin_agent_decisions (the shared agent-decision ledger, so it is
// measurable and trainable from day one) and surfacing to a daily Telegram
// digest for the owner. Humans act; the agent watches.
//
// v1 arms (data available today, no on-hand dependency):
//   - price_change     : a supplier raised a product's price beyond a threshold
//   - over_purchase    : an outlet bought materially more than it consumed
//                        this week (the "May blowout" detector)
//   - duplicate_invoice: same supplier + amount within a short window
//   - short_delivery   : received materially less than ordered
//
// Not yet armed (need the count-anchored on-hand — the keystone build):
//   - inventory_value  : on-hand value over an N-days-of-COGS ceiling
//   - stock_availability: days-of-cover below lead time (stockout risk)
// These are intentionally absent rather than faked against StockBalance,
// which only ever increments and would produce fiction.

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";
import { buildByCategory, type OutletPick } from "@/app/api/sales/_lib/reports";
import { sendMessage } from "@/lib/telegram";

export const PURCHASING_MANAGER_VERSION = "purchasing-mgr-v1";

// Tunables. Changing these is a product decision; keep them here, not inline.
const PRICE_CHANGE_PCT = 10;    // flag a supplier price move of >= this %
const OVER_BUY_GAP_PCT = 25;    // flag weekly purchases > consumption x 1.25
const OVER_BUY_MIN_RM = 2000;   // ignore tiny outlets/weeks below this gap
const SHORT_DELIVERY_PCT = 10;  // flag received < ordered by >= this %
const SHORT_DELIVERY_MIN_RM = 50;
const DUP_INVOICE_DAYS = 14;
const LOOKBACK_DAYS = 8;        // detection window for price/receiving/invoice

export type FindingKind = "price_change" | "over_purchase" | "duplicate_invoice" | "short_delivery";
export type Severity = "info" | "warn" | "high";

export type Finding = {
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  outletId: string | null;
  supplierId: string | null;
  productId: string | null;
  data: Record<string, unknown>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const rm = (n: number) => `RM${Math.round(n).toLocaleString("en-MY")}`;

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

// ─── price_change ─────────────────────────────────────────────────────────
export async function detectPriceChanges(): Promise<Finding[]> {
  const rows = await prisma.priceHistory.findMany({
    where: { changedAt: { gte: sinceDate(LOOKBACK_DAYS) } },
    orderBy: { changedAt: "desc" },
  });
  const out: Finding[] = [];
  const prodIds = [...new Set(rows.map((r) => r.productId))];
  const supIds = [...new Set(rows.map((r) => r.supplierId))];
  const [products, suppliers] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } }),
  ]);
  const pName = new Map(products.map((p) => [p.id, p.name]));
  const sName = new Map(suppliers.map((s) => [s.id, s.name]));
  for (const r of rows) {
    const pct = Number(r.changePercent);
    if (Math.abs(pct) < PRICE_CHANGE_PCT) continue;
    const up = pct > 0;
    out.push({
      kind: "price_change",
      severity: Math.abs(pct) >= 25 ? "high" : "warn",
      title: `${pName.get(r.productId) ?? "Product"} ${up ? "up" : "down"} ${Math.abs(Math.round(pct))}%`,
      detail: `${sName.get(r.supplierId) ?? "Supplier"} changed ${pName.get(r.productId) ?? r.productId} from ${rm(Number(r.oldPrice))} to ${rm(Number(r.newPrice))} (${up ? "+" : ""}${Math.round(pct)}%).`,
      outletId: null,
      supplierId: r.supplierId,
      productId: r.productId,
      data: { oldPrice: Number(r.oldPrice), newPrice: Number(r.newPrice), changePercent: round2(pct), changedAt: r.changedAt.toISOString() },
    });
  }
  return out;
}

// ─── duplicate_invoice ────────────────────────────────────────────────────
export async function detectDuplicateInvoices(): Promise<Finding[]> {
  const invs = await prisma.invoice.findMany({
    where: {
      issueDate: { gte: sinceDate(DUP_INVOICE_DAYS) },
      status: { not: "DRAFT" },
      supplierId: { not: null },
    },
    select: { id: true, supplierId: true, amount: true, issueDate: true, outletId: true, invoiceNumber: true },
  });
  // True double-entries are same supplier + amount + day + OUTLET. Two guards
  // against false positives: the day (recurring daily deliveries repeat the
  // same amount on different days), and the outlet (a supplier delivering the
  // same standing order to several outlets on one day is legitimate, not a
  // duplicate).
  const bySupAmt = new Map<string, typeof invs>();
  for (const i of invs) {
    const key = `${i.supplierId}|${round2(Number(i.amount))}|${i.issueDate.toISOString().slice(0, 10)}|${i.outletId}`;
    (bySupAmt.get(key) ?? bySupAmt.set(key, []).get(key)!).push(i);
  }
  const supIds = [...new Set(invs.map((i) => i.supplierId!).filter(Boolean))];
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } });
  const sName = new Map(suppliers.map((s) => [s.id, s.name]));
  const out: Finding[] = [];
  for (const group of bySupAmt.values()) {
    if (group.length < 2) continue;
    const amt = Number(group[0].amount);
    const day = group[0].issueDate.toISOString().slice(0, 10);
    out.push({
      kind: "duplicate_invoice",
      severity: "high",
      title: `Possible duplicate invoice ${rm(amt)}`,
      detail: `${group.length} invoices to ${sName.get(group[0].supplierId!) ?? "supplier"} for the same ${rm(amt)} on ${day} (${group.map((g) => g.invoiceNumber).join(", ")}). Verify before paying twice.`,
      outletId: group[0].outletId,
      supplierId: group[0].supplierId,
      productId: null,
      data: { invoiceIds: group.map((g) => g.id), amount: amt, count: group.length },
    });
  }
  return out;
}

// ─── short_delivery ───────────────────────────────────────────────────────
export async function detectShortDeliveries(): Promise<Finding[]> {
  const items = await prisma.receivingItem.findMany({
    where: {
      orderedQty: { not: null },
      receiving: { receivedAt: { gte: sinceDate(LOOKBACK_DAYS) } },
    },
    select: {
      productId: true, orderedQty: true, receivedQty: true,
      productPackageId: true,
      receiving: { select: { outletId: true, supplierId: true } },
    },
  });
  const prodIds = [...new Set(items.map((i) => i.productId))];
  const [products, sps] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, name: true } }),
    prisma.supplierProduct.findMany({ where: { productId: { in: prodIds }, isActive: true }, select: { productId: true, productPackageId: true, price: true } }),
  ]);
  const pName = new Map(products.map((p) => [p.id, p.name]));
  const price = new Map<string, number>();
  for (const sp of sps) {
    const key = sp.productPackageId ? `pkg:${sp.productPackageId}` : `base:${sp.productId}`;
    const p = Number(sp.price);
    if (!price.has(key) || p < price.get(key)!) price.set(key, p);
  }
  const out: Finding[] = [];
  for (const it of items) {
    const ordered = Number(it.orderedQty);
    const received = Number(it.receivedQty);
    if (ordered <= 0 || received >= ordered) continue;
    const shortPct = ((ordered - received) / ordered) * 100;
    if (shortPct < SHORT_DELIVERY_PCT) continue;
    const unit = it.productPackageId ? price.get(`pkg:${it.productPackageId}`) : price.get(`base:${it.productId}`);
    const shortRm = unit ? round2((ordered - received) * unit) : 0;
    if (unit && shortRm < SHORT_DELIVERY_MIN_RM) continue;
    out.push({
      kind: "short_delivery",
      severity: shortPct >= 50 ? "high" : "warn",
      title: `Short delivery: ${pName.get(it.productId) ?? "item"} ${Math.round(shortPct)}% under`,
      detail: `${pName.get(it.productId) ?? "Item"}: ordered ${ordered}, received ${received} (${Math.round(shortPct)}% short${shortRm ? `, ~${rm(shortRm)}` : ""}). Chase the balance or a credit note.`,
      outletId: it.receiving.outletId,
      supplierId: it.receiving.supplierId,
      productId: it.productId,
      data: { orderedQty: ordered, receivedQty: received, shortPct: round2(shortPct), shortRm },
    });
  }
  return out;
}

// ─── over_purchase ────────────────────────────────────────────────────────
// Per outlet over a TRAILING 7-day window (not week-to-date, which spikes
// early in the week when full purchases meet only a day of sales): procurement
// invoices vs theoretical consumption (sales x recipes at cost — the same
// engine as the COGS report). Flags outlets buying materially more than they
// used. Consignment sites (0 recipe consumption) are skipped: their stock is
// supplied by transfers, so their own purchases are not a meaningful signal.
export async function detectOverBuy(): Promise<Finding[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
  });
  const out: Finding[] = [];
  for (const o of outlets) {
    const [cat, inv] = await Promise.all([
      buildByCategory([o as OutletPick], from, to),
      prisma.invoice.aggregate({ _sum: { amount: true }, where: { issueDate: { gte: start, lte: end }, outletId: o.id } }),
    ]);
    const consumption = round2(Number(cat.total?.cogs) || 0);
    const purchases = round2(Number(inv._sum?.amount ?? 0));
    if (consumption <= 0) continue; // consignment / no recipe sales — skip
    const gap = round2(purchases - consumption);
    const gapPct = round2((gap / consumption) * 100);
    if (gap < OVER_BUY_MIN_RM || gapPct < OVER_BUY_GAP_PCT) continue;
    out.push({
      kind: "over_purchase",
      severity: gapPct >= 50 ? "high" : "warn",
      title: `${o.name} over-buying +${Math.round(gapPct)}%`,
      detail: `${o.name}: last 7 days purchases ${rm(purchases)} vs consumption ${rm(consumption)}, ${rm(gap)} (+${Math.round(gapPct)}%) more stock than sales used. Check what was bought against days-of-cover before the next order.`,
      outletId: o.id,
      supplierId: null,
      productId: null,
      data: { from, to, purchases, consumption, gap, gapPct },
    });
  }
  return out;
}

// Persist every finding to the shared agent-decision ledger (advisory:
// applied=false, confidence 1.0 — deterministic detectors).
async function logFindings(findings: Finding[]): Promise<number> {
  if (!findings.length) return 0;
  const client = getFinanceClient();
  const rows = findings.map((f) => ({
    id: randomUUID(),
    agent: "purchasing-manager",
    agent_version: PURCHASING_MANAGER_VERSION,
    input: { kind: f.kind, outletId: f.outletId, supplierId: f.supplierId, productId: f.productId },
    output: { severity: f.severity, title: f.title, detail: f.detail, data: f.data },
    confidence: 1.0,
    applied: false,
    related_type: f.kind,
    related_id: f.productId ?? f.outletId ?? f.supplierId ?? null,
  }));
  const { error } = await client.from("fin_agent_decisions").insert(rows);
  if (error) throw new Error(`purchasing-manager log failed: ${error.message}`);
  return rows.length;
}

export async function runPurchasingManager(): Promise<{ findings: Finding[]; logged: number }> {
  const groups = await Promise.all([
    detectPriceChanges(),
    detectOverBuy(),
    detectDuplicateInvoices(),
    detectShortDeliveries(),
  ]);
  const order: FindingKind[] = ["over_purchase", "duplicate_invoice", "price_change", "short_delivery"];
  const sev: Record<Severity, number> = { high: 0, warn: 1, info: 2 };
  const findings = groups.flat().sort((a, b) => sev[a.severity] - sev[b.severity] || order.indexOf(a.kind) - order.indexOf(b.kind));
  const logged = await logFindings(findings);
  return { findings, logged };
}

// Run the agent and deliver a digest to the owner when there is anything to
// flag (silence = all clear). Shared by the daily procurement dispatcher and
// the on-demand route. Never throws to the caller — the digest is best-effort.
export async function runAndNotify(): Promise<{ flags: number; logged: number; delivered: boolean; byKind: Record<string, number> }> {
  const { findings, logged } = await runPurchasingManager();
  let delivered = false;
  const chatRaw = process.env.TELEGRAM_OWNER_CHAT_ID;
  const chatId = chatRaw ? parseInt(chatRaw, 10) : NaN;
  if (findings.length > 0 && !Number.isNaN(chatId)) {
    try {
      const res = await sendMessage(chatId, formatDigest(findings));
      delivered = res.ok;
    } catch (e) {
      console.error("[purchasing-manager] telegram send failed", e);
    }
  }
  const byKind = findings.reduce<Record<string, number>>((m, f) => ((m[f.kind] = (m[f.kind] ?? 0) + 1), m), {});
  return { flags: findings.length, logged, delivered, byKind };
}

// Telegram digest body. Grouped by kind, most severe first.
export function formatDigest(findings: Finding[]): string {
  if (!findings.length) return "<b>Purchasing Manager</b>\nAll clear, no procurement flags today.";
  const lines: string[] = [`<b>Purchasing Manager</b> — ${findings.length} flag${findings.length > 1 ? "s" : ""}`];
  const icon: Record<Severity, string> = { high: "🔴", warn: "🟠", info: "⚪" };
  const heading: Record<FindingKind, string> = {
    over_purchase: "Over-buying", duplicate_invoice: "Duplicate invoices",
    price_change: "Price changes", short_delivery: "Short deliveries",
  };
  let lastKind: FindingKind | null = null;
  for (const f of findings) {
    if (f.kind !== lastKind) { lines.push(`\n<b>${heading[f.kind]}</b>`); lastKind = f.kind; }
    lines.push(`${icon[f.severity]} ${f.detail}`);
  }
  lines.push(`\nReview: backoffice.celsiuscoffee.com/finance/inbox`);
  return lines.join("\n");
}
