/**
 * StoreHub-style "Reports 2.0" data builders for the backoffice Sales reports.
 * Mirrors StoreHub's report set on our own data, now that StoreHub is retired:
 *   • over-time  — sales/transactions/AOV per day|week|month, split by channel
 *   • product    — qty sold, sales, cost, gross profit per product
 *   • category   — same, grouped by product category
 *   • payment    — sales/transactions per payment method
 *
 * Sources & cutover routing (identical rule to unified-sales.ts, so the
 * over-time totals reconcile with the Sales dashboard):
 *   • over-time uses getUnifiedSalesForOutlet (StoreHub archive pre-cutover +
 *     live-today + POS-native + pickup, already cutover-routed, no double-count).
 *   • product/category gather line items with the SAME per-outlet cutover gate:
 *     storehub_sale_items pre-cutover (+ external delivery), pos_order_items and
 *     pickup order_items at/after cutover. Pickup never lived in StoreHub so it
 *     is always included.
 *   • payment is POS-native (pos_order_payments) + pickup only — StoreHub never
 *     exposed payment splits, so this report is post-cutover by nature.
 *
 * Money: storehub archive is already RM (numeric); pos and orders are SEN (int).
 * Everything is normalised to RM (number) inside here; the client just formats.
 * Dates are MYT (UTC+8) calendar days.
 */

import { prisma } from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { getUnifiedSalesForOutlet } from "./unified-sales";
import {
  CHANNEL_LABELS,
  normalizePayment,
  PAY_LABELS,
  getMYTDateStr,
  addDays,
  dayOfWeek,
  round2,
  type ChannelKey,
  type PayKey,
} from "./native-sales-helpers";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ReportKind =
  | "over-time"
  | "channel"
  | "product"
  | "category"
  | "payment"
  | "promotion"
  | "shift";
export type GroupBy = "day" | "week" | "month";

export type OutletPick = {
  id: string;
  name: string;
  storehubId: string | null;
  loyaltyOutletId: string | null;
  pickupStoreId: string | null;
  posNativeCutoverAt: Date | null;
};

/** A generic report column. `kind` drives client formatting; `tip` shows a ⓘ. */
export type Column = { key: string; label: string; kind: "text" | "rm" | "int" | "pct"; tip?: string };
export type Row = Record<string, string | number>;
export type ReportResult = {
  report: ReportKind;
  columns: Column[];
  rows: Row[];
  total: Row | null;
  chart?: { label: string; value: number }[];
  note?: string;
};

const isExternalDelivery = (channel: string | null | undefined): boolean =>
  !!channel && /grab|panda|shopee|beep|deliver/i.test(channel);

const dmy = (dateStr: string): string => {
  const d = new Date(`${dateStr}T12:00:00+08:00`);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
};
const WK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── helper: MYT day bounds as UTC Date for SQL params ──
const dayStart = (dateStr: string) => new Date(`${dateStr}T00:00:00+08:00`);
const dayEnd = (dateStr: string) => new Date(`${dateStr}T23:59:59.999+08:00`);

// ─────────────────────────────────────────────────────────────────────────────
// Over time
// ─────────────────────────────────────────────────────────────────────────────
export async function buildOverTime(
  outlets: OutletPick[],
  from: string,
  to: string,
  groupBy: GroupBy,
): Promise<ReportResult> {
  const fromD = dayStart(from);
  const toD = dayEnd(to);

  const settled = await Promise.allSettled(
    outlets.map((o) =>
      getUnifiedSalesForOutlet(
        {
          outletId: o.id,
          storehubStoreId: o.storehubId,
          loyaltyOutletId: o.loyaltyOutletId,
          pickupStoreId: o.pickupStoreId,
          cutoverAt: o.posNativeCutoverAt,
        },
        fromD,
        toD,
        {},
      ),
    ),
  );

  type Bucket = {
    sortKey: string;
    label: string;
    total: number;
    txns: number;
    chan: Record<ChannelKey, number>;
  };
  const buckets = new Map<string, Bucket>();
  const blankChan = (): Record<ChannelKey, number> =>
    ({ dine_in: 0, takeaway: 0, delivery: 0, pickup: 0, qr_table: 0 });

  const periodFor = (dateStr: string): { sortKey: string; label: string } => {
    if (groupBy === "month") {
      const d = new Date(`${dateStr}T12:00:00+08:00`);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { sortKey: key, label: `${MON[d.getMonth()]} ${d.getFullYear()}` };
    }
    if (groupBy === "week") {
      const wkStart = addDays(dateStr, -dayOfWeek(dateStr));
      const wkEnd = addDays(wkStart, 6);
      return { sortKey: wkStart, label: `${dmy(wkStart)} – ${dmy(wkEnd)}` };
    }
    return { sortKey: dateStr, label: `${dmy(dateStr)} (${WK[dayOfWeek(dateStr)]})` };
  };

  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const ev of r.value) {
      const dateStr = getMYTDateStr(ev.ts);
      if (dateStr < from || dateStr > to) continue;
      const { sortKey, label } = periodFor(dateStr);
      let b = buckets.get(sortKey);
      if (!b) {
        b = { sortKey, label, total: 0, txns: 0, chan: blankChan() };
        buckets.set(sortKey, b);
      }
      b.total += ev.total;
      b.txns += 1;
      b.chan[ev.channel] += ev.total;
    }
  }

  const ordered = [...buckets.values()].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
  const rows: Row[] = ordered.map((b) => ({
    period: b.label,
    totalSales: round2(b.total),
    transactions: b.txns,
    aov: b.txns ? round2(b.total / b.txns) : 0,
    dine_in: round2(b.chan.dine_in),
    takeaway: round2(b.chan.takeaway),
    delivery: round2(b.chan.delivery),
  }));

  const tTotal = ordered.reduce((s, b) => s + b.total, 0);
  const tTxns = ordered.reduce((s, b) => s + b.txns, 0);
  const total: Row = {
    period: "Total",
    totalSales: round2(tTotal),
    transactions: tTxns,
    aov: tTxns ? round2(tTotal / tTxns) : 0,
    dine_in: round2(ordered.reduce((s, b) => s + b.chan.dine_in, 0)),
    takeaway: round2(ordered.reduce((s, b) => s + b.chan.takeaway, 0)),
    delivery: round2(ordered.reduce((s, b) => s + b.chan.delivery, 0)),
  };

  return {
    report: "over-time",
    columns: [
      { key: "period", label: groupBy === "month" ? "Month" : groupBy === "week" ? "Week" : "Date", kind: "text" },
      { key: "totalSales", label: "Total Sales", kind: "rm" },
      { key: "transactions", label: "Transactions", kind: "int" },
      { key: "aov", label: "Avg Order", kind: "rm" },
      { key: "dine_in", label: CHANNEL_LABELS.dine_in, kind: "rm" },
      { key: "takeaway", label: CHANNEL_LABELS.takeaway, kind: "rm" },
      { key: "delivery", label: CHANNEL_LABELS.delivery, kind: "rm" },
    ],
    rows,
    total,
    chart: ordered.map((b) => ({ label: b.label, value: round2(b.total) })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// By channel (Dine-in / Takeaway / Grab) — same unified, cutover-routed source
// as over-time, so totals and the per-channel split reconcile exactly.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildByChannel(outlets: OutletPick[], from: string, to: string): Promise<ReportResult> {
  const fromD = dayStart(from);
  const toD = dayEnd(to);

  const settled = await Promise.allSettled(
    outlets.map((o) =>
      getUnifiedSalesForOutlet(
        {
          outletId: o.id,
          storehubStoreId: o.storehubId,
          loyaltyOutletId: o.loyaltyOutletId,
          pickupStoreId: o.pickupStoreId,
          cutoverAt: o.posNativeCutoverAt,
        },
        fromD,
        toD,
        {},
      ),
    ),
  );

  const agg = new Map<ChannelKey, { sales: number; txns: number }>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const ev of r.value) {
      const d = getMYTDateStr(ev.ts);
      if (d < from || d > to) continue;
      const cur = agg.get(ev.channel) ?? { sales: 0, txns: 0 };
      cur.sales += ev.total;
      cur.txns += 1;
      agg.set(ev.channel, cur);
    }
  }

  const grand = [...agg.values()].reduce((s, v) => s + v.sales, 0) || 1;
  const rows: Row[] = [...agg.entries()]
    .map(([k, v]) => ({
      channel: CHANNEL_LABELS[k],
      transactions: v.txns,
      totalSales: round2(v.sales),
      aov: v.txns ? round2(v.sales / v.txns) : 0,
      sharePct: round2((v.sales / grand) * 100),
    }))
    .sort((a, b) => (b.totalSales as number) - (a.totalSales as number));

  const tSales = [...agg.values()].reduce((s, v) => s + v.sales, 0);
  const tTxns = [...agg.values()].reduce((s, v) => s + v.txns, 0);
  const total: Row = {
    channel: "Total",
    transactions: tTxns,
    totalSales: round2(tSales),
    aov: tTxns ? round2(tSales / tTxns) : 0,
    sharePct: 100,
  };

  return {
    report: "channel",
    columns: [
      { key: "channel", label: "Channel", kind: "text" },
      { key: "transactions", label: "Transactions", kind: "int" },
      { key: "totalSales", label: "Total Sales", kind: "rm" },
      { key: "aov", label: "Avg Order", kind: "rm" },
      { key: "sharePct", label: "% of Total", kind: "pct" },
    ],
    rows,
    total,
    chart: rows.map((r) => ({ label: r.channel as string, value: r.totalSales as number })),
  };
}

// Per-menu cost model, keyed by lower(name) — the reliable join across sources.
//   • ingredientCostByName — recipe (BOM) unit cost: Σ ingredient qty × cheapest
//     non-ADHOC supplier price ÷ pack conversion. (products.cost is empty.)
//   • pkgUnitCost(name, channel, temp) — packaging unit cost, applied exactly like
//     the Menu BOM / Packaging-rules screens: conditional on channel (dine-in vs
//     takeaway) and temperature (Hot/Iced), so a dine-in hot drink and a takeaway
//     iced drink carry different packaging. Sources: PACKAGING-type BOM lines +
//     per-item PackagingRule rows (per-order rules like a Grab bag are excluded —
//     they're order-level, not per item). Menus with no recipe → ingredient 0.
type PkgChannel = "ALL" | "DINE_IN" | "TAKEAWAY";
type PkgEntry = { cost: number; channel: PkgChannel; modifier: "Iced" | "Hot" | null };
type CostModel = {
  ingredientCostByName: Map<string, number>;
  pkgUnitCost: (nameKey: string, channel: "DINE_IN" | "TAKEAWAY", temp: "Iced" | "Hot") => number;
};

async function buildCostModel(): Promise<CostModel> {
  const [menus, supplierProducts, rules] = await Promise.all([
    prisma.menu.findMany({
      select: {
        id: true,
        name: true,
        category: true,
        ingredients: {
          select: {
            productId: true,
            quantityUsed: true,
            serviceMode: true,
            modifier: true,
            product: { select: { itemType: true } },
          },
        },
      },
    }),
    prisma.supplierProduct.findMany({
      where: { isActive: true },
      select: {
        productId: true,
        price: true,
        productPackage: { select: { conversionFactor: true } },
        supplier: { select: { supplierCode: true } },
      },
    }),
    prisma.packagingRule.findMany({
      where: { isActive: true, perOrder: false },
      select: { productId: true, quantity: true, scope: true, category: true, menuIds: true, channel: true, modifier: true },
    }),
  ]);

  const costPerBase = new Map<string, number>();
  for (const sp of supplierProducts) {
    if (sp.supplier?.supplierCode === "ADHOC") continue; // RM0 placeholder supplier
    const price = Number(sp.price);
    if (price <= 0) continue;
    const conv = sp.productPackage?.conversionFactor ? Number(sp.productPackage.conversionFactor) : 0;
    if (conv <= 0) continue;
    const c = price / conv;
    const ex = costPerBase.get(sp.productId);
    if (ex == null || c < ex) costPerBase.set(sp.productId, c);
  }

  // GRAB / DELIVERY / TAKEAWAY all collapse to "takeaway" packaging (disposable
  // cup etc.); only dine-in is distinct. Mirrors the Menu BOM 2×2 matrix.
  const normChan = (c: string): PkgChannel => (c === "ALL" ? "ALL" : c === "DINE_IN" ? "DINE_IN" : "TAKEAWAY");

  const ingredientCostByName = new Map<string, number>();
  const pkgByName = new Map<string, PkgEntry[]>();
  const keyByMenuId = new Map<string, string>();
  const keysByCategory = new Map<string, string[]>();
  const allKeys: string[] = [];
  const addEntry = (key: string, e: PkgEntry) => {
    const arr = pkgByName.get(key);
    if (arr) arr.push(e);
    else pkgByName.set(key, [e]);
  };

  for (const m of menus) {
    if (!m.name) continue;
    const key = m.name.trim().toLowerCase();
    keyByMenuId.set(m.id, key);
    allKeys.push(key);
    if (m.category) {
      const arr = keysByCategory.get(m.category);
      if (arr) arr.push(key);
      else keysByCategory.set(m.category, [key]);
    }
    let ing = 0;
    for (const li of m.ingredients) {
      const unit = costPerBase.get(li.productId) ?? 0;
      const c = Number(li.quantityUsed) * unit;
      if (li.product.itemType === "PACKAGING") {
        if (c > 0) addEntry(key, { cost: c, channel: normChan(li.serviceMode), modifier: (li.modifier as "Iced" | "Hot" | null) ?? null });
      } else {
        ing += c;
      }
    }
    ingredientCostByName.set(key, round2(ing));
  }

  for (const r of rules) {
    const unit = costPerBase.get(r.productId) ?? 0;
    const cost = Number(r.quantity) * unit;
    if (cost <= 0) continue;
    const entry: PkgEntry = { cost, channel: normChan(r.channel), modifier: (r.modifier as "Iced" | "Hot" | null) ?? null };
    const keys =
      r.scope === "ALL" ? allKeys :
      r.scope === "CATEGORY" ? (keysByCategory.get(r.category ?? "") ?? []) :
      r.menuIds.map((id) => keyByMenuId.get(id)).filter((k): k is string => !!k);
    for (const k of keys) addEntry(k, entry);
  }

  const pkgUnitCost = (nameKey: string, channel: "DINE_IN" | "TAKEAWAY", temp: "Iced" | "Hot"): number => {
    const entries = pkgByName.get(nameKey);
    if (!entries) return 0;
    let s = 0;
    for (const e of entries) {
      if (e.channel !== "ALL" && e.channel !== channel) continue;
      if (e.modifier !== null && e.modifier !== temp) continue;
      s += e.cost;
    }
    return s;
  };

  return { ingredientCostByName, pkgUnitCost };
}

// ─────────────────────────────────────────────────────────────────────────────
// Line-item gathering (shared by product + category), cutover-routed.
// Returns one entry per source line, in RM, with category + unit cost resolved.
// ─────────────────────────────────────────────────────────────────────────────
type GatheredItem = { name: string; category: string; qty: number; sales: number; cost: number };

async function gatherItems(outlets: OutletPick[], from: string, to: string): Promise<GatheredItem[]> {
  const supabase = getSupabaseAdmin();
  const fromD = dayStart(from);
  const toD = dayEnd(to);

  // Category from our catalog (the StoreHub archive fills gaps); unit cost from
  // the cost model (recipe + packaging). Keyed by lower(name) across sources.
  const [{ data: products }, { data: shProducts }, costModel] = await Promise.all([
    supabase.from("products").select("name, category"),
    supabase.from("storehub_products").select("name, category"),
    buildCostModel(),
  ]);
  const norm = (n: string) => n.trim().toLowerCase();
  const prettyCat = (c: string) =>
    c.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

  const catByName = new Map<string, string>();
  for (const p of shProducts ?? []) {
    const name = (p.name as string) || "";
    if (name && p.category) catByName.set(norm(name), prettyCat(p.category as string));
  }
  for (const p of products ?? []) {
    const name = (p.name as string) || "";
    // our catalog is the canonical category source — it overrides StoreHub's.
    if (name && p.category) catByName.set(norm(name), prettyCat(p.category as string));
  }
  const catOf = (name: string) => catByName.get(norm(name)) ?? "Uncategorized";

  // Temperature drives which cup/lid/straw rule applies. POS lines carry it in
  // modifiers ([{name:"Iced"|"Hot"}]); pickup + archive don't record it, so we
  // fall back to Iced — the dominant variant — to keep packaging costed.
  const tempFromModifiers = (mods: unknown): "Iced" | "Hot" => {
    if (Array.isArray(mods)) {
      for (const m of mods) {
        const n = m && typeof m === "object" && "name" in m ? String((m as { name: unknown }).name) : "";
        if (n === "Iced") return "Iced";
        if (n === "Hot") return "Hot";
      }
    }
    return "Iced";
  };
  // All-in unit cost (RM) = recipe + packaging for this line's channel & temp.
  const unitCost = (name: string, channel: "DINE_IN" | "TAKEAWAY", temp: "Iced" | "Hot") =>
    (costModel.ingredientCostByName.get(norm(name)) ?? 0) + costModel.pkgUnitCost(norm(name), channel, temp);

  type ShRow = { name: string | null; quantity: unknown; total: unknown; ts: Date; channel: string | null };
  type PosRow = { product_name: string | null; quantity: unknown; item_total: unknown; fulfillment: string | null; source: string | null; modifiers: unknown };
  type AppRow = { product_name: string | null; quantity: unknown; item_total: unknown; order_type: string | null; modifiers: unknown };
  const empty = Promise.resolve([] as never[]);

  // One outlet's lines; its three source queries run concurrently.
  const perOutlet = await Promise.all(
    outlets.map(async (o): Promise<GatheredItem[]> => {
      const cutoverMs = o.posNativeCutoverAt ? o.posNativeCutoverAt.getTime() : Number.POSITIVE_INFINITY;
      const [shRows, posRows, appRows] = await Promise.all([
        // StoreHub archive — pre-cutover, or external delivery post-cutover.
        o.id
          ? prisma.$queryRaw<ShRow[]>`
              SELECT si.name, si.quantity, si.total, si.transaction_time AS ts, s.channel
              FROM storehub_sale_items si
              JOIN storehub_sales s ON s.id = si.sale_id
              WHERE si.outlet_id = ${o.id}
                AND NOT s.is_cancelled
                AND si.transaction_time >= ${fromD}
                AND si.transaction_time <= ${toD}`
          : empty,
        // POS-native — at/after cutover (no native rows exist pre-cutover).
        o.loyaltyOutletId
          ? prisma.$queryRaw<PosRow[]>`
              SELECT i.product_name, i.quantity, i.item_total, i.fulfillment, o.source, i.modifiers
              FROM pos_order_items i
              JOIN pos_orders o ON o.id = i.order_id
              WHERE o.outlet_id = ${o.loyaltyOutletId}
                AND o.status = 'completed'
                AND o.refund_of_order_id IS NULL
                AND o.created_at >= ${fromD}
                AND o.created_at <= ${toD}`
          : empty,
        // Pickup app — always included (never lived in StoreHub).
        o.pickupStoreId
          ? prisma.$queryRaw<AppRow[]>`
              SELECT i.product_name, i.quantity, i.item_total, o.order_type, i.modifiers
              FROM order_items i
              JOIN orders o ON o.id = i.order_id
              WHERE o.store_id = ${o.pickupStoreId}
                AND o.status = 'completed'
                AND o.created_at >= ${fromD}
                AND o.created_at <= ${toD}`
          : empty,
      ]);

      const out: GatheredItem[] = [];
      for (const r of shRows as ShRow[]) {
        const tsMs = r.ts instanceof Date ? r.ts.getTime() : new Date(String(r.ts)).getTime();
        if (!(tsMs < cutoverMs || isExternalDelivery(r.channel))) continue; // cutover gate
        const name = (r.name || "Unknown").trim();
        const channel = /dine/i.test(r.channel ?? "") ? "DINE_IN" : "TAKEAWAY";
        out.push({ name, category: catOf(name), qty: Number(r.quantity) || 0, sales: Number(r.total) || 0, cost: unitCost(name, channel, "Iced") });
      }
      for (const r of posRows as PosRow[]) {
        const name = (r.product_name || "Unknown").trim();
        // Grab is delivery (takeaway-style packaging) regardless of fulfillment tag.
        const channel = r.source === "grabfood" ? "TAKEAWAY" : r.fulfillment === "dine_in" ? "DINE_IN" : "TAKEAWAY";
        out.push({ name, category: catOf(name), qty: Number(r.quantity) || 0, sales: (Number(r.item_total) || 0) / 100, cost: unitCost(name, channel, tempFromModifiers(r.modifiers)) });
      }
      for (const r of appRows as AppRow[]) {
        const name = (r.product_name || "Unknown").trim();
        const channel = r.order_type === "dine_in" ? "DINE_IN" : "TAKEAWAY";
        out.push({ name, category: catOf(name), qty: Number(r.quantity) || 0, sales: (Number(r.item_total) || 0) / 100, cost: unitCost(name, channel, tempFromModifiers(r.modifiers)) });
      }
      return out;
    }),
  );

  return perOutlet.flat();
}

const GP_TIP = "Gross profit = sales − COGS (recipe + packaging cost). Items with no recipe or packaging show 100%.";
const COGS_TIP = "Cost of goods sold = qty × unit cost (recipe ingredients + packaging). Packaging (cup / lid / straw) is applied per the sale's channel (dine-in vs takeaway) and Hot/Iced.";
const COST_NOTE =
  "Unit cost / COGS come from the BOM recipe (ingredient supplier prices) plus packaging rules, applied by each sale's channel (dine-in vs takeaway) and temperature (Hot/Iced). Where temperature isn't recorded (pickup app, archived sales) it defaults to Iced. Per-order packaging (e.g. a Grab carrier bag) isn't included. Items without a recipe read as recipe cost 0.";

export async function buildByProduct(outlets: OutletPick[], from: string, to: string): Promise<ReportResult> {
  const items = await gatherItems(outlets, from, to);
  type Agg = { name: string; category: string; qty: number; sales: number; costTotal: number };
  const map = new Map<string, Agg>();
  for (const it of items) {
    let a = map.get(it.name);
    if (!a) {
      a = { name: it.name, category: it.category, qty: 0, sales: 0, costTotal: 0 };
      map.set(it.name, a);
    }
    a.qty += it.qty;
    a.sales += it.sales;
    a.costTotal += it.qty * it.cost;
  }
  const rows: Row[] = [...map.values()]
    .map((a) => {
      const gp = a.sales - a.costTotal;
      return {
        name: a.name,
        category: a.category,
        qty: round2(a.qty),
        totalSales: round2(a.sales),
        cogs: round2(a.costTotal),
        avgCost: a.qty ? round2(a.costTotal / a.qty) : 0,
        grossProfit: round2(gp),
        gpPct: a.sales ? round2((gp / a.sales) * 100) : 0,
      };
    })
    .sort((x, y) => (y.totalSales as number) - (x.totalSales as number));

  const tSales = rows.reduce((s, r) => s + (r.totalSales as number), 0);
  const tCost = [...map.values()].reduce((s, a) => s + a.costTotal, 0);
  const tQty = rows.reduce((s, r) => s + (r.qty as number), 0);
  const total: Row = {
    name: "Total",
    category: "",
    qty: round2(tQty),
    totalSales: round2(tSales),
    cogs: round2(tCost),
    avgCost: tQty ? round2(tCost / tQty) : 0,
    grossProfit: round2(tSales - tCost),
    gpPct: tSales ? round2(((tSales - tCost) / tSales) * 100) : 0,
  };

  return {
    report: "product",
    columns: [
      { key: "name", label: "Product", kind: "text" },
      { key: "category", label: "Category", kind: "text" },
      { key: "qty", label: "Qty Sold", kind: "int" },
      { key: "totalSales", label: "Total Sales", kind: "rm" },
      { key: "cogs", label: "COGS", kind: "rm", tip: COGS_TIP },
      { key: "avgCost", label: "Avg Cost", kind: "rm", tip: COST_NOTE },
      { key: "grossProfit", label: "Gross Profit", kind: "rm", tip: GP_TIP },
      { key: "gpPct", label: "Gross Profit %", kind: "pct", tip: GP_TIP },
    ],
    rows,
    total,
    note: COST_NOTE,
  };
}

export async function buildByCategory(outlets: OutletPick[], from: string, to: string): Promise<ReportResult> {
  const items = await gatherItems(outlets, from, to);
  type Agg = { category: string; qty: number; sales: number; costTotal: number };
  const map = new Map<string, Agg>();
  for (const it of items) {
    let a = map.get(it.category);
    if (!a) {
      a = { category: it.category, qty: 0, sales: 0, costTotal: 0 };
      map.set(it.category, a);
    }
    a.qty += it.qty;
    a.sales += it.sales;
    a.costTotal += it.qty * it.cost;
  }
  const grand = [...map.values()].reduce((s, a) => s + a.sales, 0) || 1;
  const rows: Row[] = [...map.values()]
    .map((a) => {
      const gp = a.sales - a.costTotal;
      return {
        category: a.category,
        qty: round2(a.qty),
        totalSales: round2(a.sales),
        cogs: round2(a.costTotal),
        grossProfit: round2(gp),
        gpPct: a.sales ? round2((gp / a.sales) * 100) : 0,
        sharePct: round2((a.sales / grand) * 100),
      };
    })
    .sort((x, y) => (y.totalSales as number) - (x.totalSales as number));

  const tSales = rows.reduce((s, r) => s + (r.totalSales as number), 0);
  const tCost = [...map.values()].reduce((s, a) => s + a.costTotal, 0);
  const tQty = rows.reduce((s, r) => s + (r.qty as number), 0);
  const total: Row = {
    category: "Total",
    qty: round2(tQty),
    totalSales: round2(tSales),
    cogs: round2(tCost),
    grossProfit: round2(tSales - tCost),
    gpPct: tSales ? round2(((tSales - tCost) / tSales) * 100) : 0,
    sharePct: 100,
  };

  return {
    report: "category",
    columns: [
      { key: "category", label: "Category", kind: "text" },
      { key: "qty", label: "Qty Sold", kind: "int" },
      { key: "totalSales", label: "Total Sales", kind: "rm" },
      { key: "cogs", label: "COGS", kind: "rm", tip: COGS_TIP },
      { key: "grossProfit", label: "Gross Profit", kind: "rm", tip: GP_TIP },
      { key: "gpPct", label: "Gross Profit %", kind: "pct", tip: GP_TIP },
      { key: "sharePct", label: "% of Sales", kind: "pct" },
    ],
    rows,
    total,
    chart: rows.map((r) => ({ label: r.category as string, value: r.totalSales as number })),
    note: COST_NOTE,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment method (POS-native + pickup only)
// ─────────────────────────────────────────────────────────────────────────────
export async function buildByPayment(outlets: OutletPick[], from: string, to: string): Promise<ReportResult> {
  const fromD = dayStart(from);
  const toD = dayEnd(to);
  const agg = new Map<PayKey, { amount: number; txns: number }>(); // amount RM
  const bump = (method: string | null, amountRM: number) => {
    const k = normalizePayment(method);
    const cur = agg.get(k) ?? { amount: 0, txns: 0 };
    cur.amount += amountRM;
    cur.txns += 1;
    agg.set(k, cur);
  };
  type PayRow = { payment_method: string | null; amount: unknown; refund_amount: unknown };
  type AppPayRow = { payment_method: string | null; total: unknown };
  const empty = Promise.resolve([] as never[]);

  await Promise.all(
    outlets.map(async (o) => {
      const [payRows, appRows] = await Promise.all([
        o.loyaltyOutletId
          ? prisma.$queryRaw<PayRow[]>`
              SELECT p.payment_method, p.amount, p.refund_amount
              FROM pos_order_payments p
              JOIN pos_orders o ON o.id = p.order_id
              WHERE o.outlet_id = ${o.loyaltyOutletId}
                AND o.status = 'completed'
                AND o.refund_of_order_id IS NULL
                AND o.created_at >= ${fromD}
                AND o.created_at <= ${toD}`
          : empty,
        o.pickupStoreId
          ? prisma.$queryRaw<AppPayRow[]>`
              SELECT payment_method, total
              FROM orders
              WHERE store_id = ${o.pickupStoreId}
                AND status = 'completed'
                AND created_at >= ${fromD}
                AND created_at <= ${toD}`
          : empty,
      ]);
      for (const r of payRows as PayRow[]) {
        bump(r.payment_method, ((Number(r.amount) || 0) - (Number(r.refund_amount) || 0)) / 100);
      }
      for (const r of appRows as AppPayRow[]) {
        bump(r.payment_method, (Number(r.total) || 0) / 100);
      }
    }),
  );

  const grand = [...agg.values()].reduce((s, v) => s + v.amount, 0) || 1;
  const rows: Row[] = [...agg.entries()]
    .map(([k, v]) => ({
      method: PAY_LABELS[k] ?? k,
      transactions: v.txns,
      totalSales: round2(v.amount),
      sharePct: round2((v.amount / grand) * 100),
    }))
    .sort((a, b) => (b.totalSales as number) - (a.totalSales as number));

  const total: Row = {
    method: "Total",
    transactions: rows.reduce((s, r) => s + (r.transactions as number), 0),
    totalSales: round2([...agg.values()].reduce((s, v) => s + v.amount, 0)),
    sharePct: 100,
  };

  return {
    report: "payment",
    columns: [
      { key: "method", label: "Payment Method", kind: "text" },
      { key: "transactions", label: "Transactions", kind: "int" },
      { key: "totalSales", label: "Total Sales", kind: "rm" },
      { key: "sharePct", label: "% of Total", kind: "pct" },
    ],
    rows,
    total,
    chart: rows.map((r) => ({ label: r.method as string, value: r.totalSales as number })),
    note: "Payment-method data covers POS-native + pickup sales (from each outlet's cutover). StoreHub never exposed payment splits, so earlier history isn't included here.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Promotions (POS-native + pickup) — POS promos (promo_name) and loyalty reward
// redemptions (reward_name) each become a row. StoreHub promos weren't archived.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildByPromotion(outlets: OutletPick[], from: string, to: string): Promise<ReportResult> {
  const fromD = dayStart(from);
  const toD = dayEnd(to);
  type Agg = { label: string; type: string; txns: number; discount: number; customers: Set<string> };
  const map = new Map<string, Agg>();
  const bump = (label: string, type: string, discountSen: number, phone: string | null) => {
    const name = (label || "").trim();
    if (!name) return;
    const key = `${type}|${name}`;
    let a = map.get(key);
    if (!a) {
      a = { label: name, type, txns: 0, discount: 0, customers: new Set() };
      map.set(key, a);
    }
    a.txns += 1;
    a.discount += (discountSen || 0) / 100;
    if (phone) a.customers.add(phone);
  };

  type PosRow = { promo_name: string | null; voucher_code: string | null; promo_discount: number | null; reward_name: string | null; reward_discount_amount: number | null; customer_phone: string | null };
  type AppRow = PosRow;
  const empty = Promise.resolve([] as never[]);

  await Promise.all(
    outlets.map(async (o) => {
      const [posRows, appRows] = await Promise.all([
        o.loyaltyOutletId
          ? prisma.$queryRaw<PosRow[]>`
              SELECT promo_name, voucher_code, promo_discount, reward_name, reward_discount_amount, customer_phone
              FROM pos_orders
              WHERE outlet_id = ${o.loyaltyOutletId}
                AND status = 'completed'
                AND refund_of_order_id IS NULL
                AND created_at >= ${fromD}
                AND created_at <= ${toD}`
          : empty,
        o.pickupStoreId
          ? prisma.$queryRaw<AppRow[]>`
              SELECT promo_name, voucher_code, promo_discount, reward_name, reward_discount_amount, customer_phone
              FROM orders
              WHERE store_id = ${o.pickupStoreId}
                AND status = 'completed'
                AND created_at >= ${fromD}
                AND created_at <= ${toD}`
          : empty,
      ]);
      for (const r of [...(posRows as PosRow[]), ...(appRows as AppRow[])]) {
        const promo = (r.promo_name || r.voucher_code || "").trim();
        if (promo) bump(promo, "Promotion", Number(r.promo_discount) || 0, r.customer_phone);
        if (r.reward_name) bump(r.reward_name, "Reward", Number(r.reward_discount_amount) || 0, r.customer_phone);
      }
    }),
  );

  const rows: Row[] = [...map.values()]
    .map((a) => ({
      label: a.label,
      type: a.type,
      transactions: a.txns,
      customers: a.customers.size,
      discount: round2(a.discount),
    }))
    .sort((a, b) => (b.discount as number) - (a.discount as number));

  const total: Row = {
    label: "Total",
    type: "",
    transactions: rows.reduce((s, r) => s + (r.transactions as number), 0),
    customers: rows.reduce((s, r) => s + (r.customers as number), 0),
    discount: round2([...map.values()].reduce((s, a) => s + a.discount, 0)),
  };

  return {
    report: "promotion",
    columns: [
      { key: "label", label: "Promotion", kind: "text" },
      { key: "type", label: "Type", kind: "text" },
      { key: "transactions", label: "Transactions", kind: "int" },
      { key: "customers", label: "Customers", kind: "int", tip: "Distinct customer phone numbers that used this promotion." },
      { key: "discount", label: "Total Discount", kind: "rm" },
    ],
    rows,
    total,
    chart: rows.slice(0, 12).map((r) => ({ label: r.label as string, value: r.discount as number })),
    note: "Promotions cover POS-native + pickup orders (promotions and loyalty reward redemptions). 'Customers' is summed per row, so a customer using two promotions counts in each.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shifts (POS-native pos_shifts) — one row per register shift. Native only.
// ─────────────────────────────────────────────────────────────────────────────
export async function buildByShift(outlets: OutletPick[], from: string, to: string): Promise<ReportResult> {
  const fromD = dayStart(from);
  const toD = dayEnd(to);
  const nameById = new Map(outlets.map((o) => [o.loyaltyOutletId, o.name] as const));
  const ids = outlets.map((o) => o.loyaltyOutletId).filter((x): x is string => !!x);

  type ShiftRow = {
    outlet_id: string | null;
    opened_at: Date | null;
    closed_at: Date | null;
    status: string | null;
    total_sales: number | null;
    total_orders: number | null;
    variance: number | null;
  };
  const shifts = ids.length
    ? await prisma.$queryRaw<ShiftRow[]>`
        SELECT outlet_id, opened_at, closed_at, status, total_sales, total_orders, variance
        FROM pos_shifts
        WHERE outlet_id = ANY(${ids})
          AND opened_at >= ${fromD}
          AND opened_at <= ${toD}
        ORDER BY opened_at DESC`
    : [];

  const fmtTs = (d: Date | null): string => {
    if (!d) return "—";
    const t = new Date(d.getTime() + 8 * 3600 * 1000);
    const mon = MON[t.getUTCMonth()];
    let h = t.getUTCHours();
    const ap = h < 12 ? "AM" : "PM";
    h = h % 12 || 12;
    return `${t.getUTCDate()} ${mon} ${h}:${String(t.getUTCMinutes()).padStart(2, "0")}${ap}`;
  };

  const rows: Row[] = shifts.map((s) => ({
    outlet: nameById.get(s.outlet_id ?? "") ?? s.outlet_id ?? "—",
    opened: fmtTs(s.opened_at),
    closed: s.status === "open" ? "Open" : fmtTs(s.closed_at),
    orders: Number(s.total_orders) || 0,
    totalSales: round2((Number(s.total_sales) || 0) / 100),
    variance: s.variance == null ? 0 : round2((Number(s.variance) || 0) / 100),
  }));

  const total: Row = {
    outlet: "Total",
    opened: "",
    closed: "",
    orders: rows.reduce((s, r) => s + (r.orders as number), 0),
    totalSales: round2(rows.reduce((s, r) => s + (r.totalSales as number), 0)),
    variance: round2(rows.reduce((s, r) => s + (r.variance as number), 0)),
  };

  return {
    report: "shift",
    columns: [
      { key: "outlet", label: "Outlet", kind: "text" },
      { key: "opened", label: "Opened", kind: "text" },
      { key: "closed", label: "Closed", kind: "text" },
      { key: "orders", label: "Orders", kind: "int" },
      { key: "totalSales", label: "Total Sales", kind: "rm" },
      { key: "variance", label: "Cash Variance", kind: "rm", tip: "Counted closing cash minus expected. 0 when cash wasn't counted at close." },
    ],
    rows,
    total,
    note: "Shifts are POS-native register sessions (pos_shifts). Cash variance is 0 where closing cash wasn't counted — the outlets are card-heavy.",
  };
}
