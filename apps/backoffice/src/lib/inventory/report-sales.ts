import { prisma } from "@/lib/prisma";
import { expandSoldLine, normaliseModifiers, type RecipeLine } from "@celsius/db";

// Sales + costing plumbing shared by the inventory reports (COGS, usage
// variance). The reports used to read `SalesTransaction`, the StoreHub-era
// feed, which stopped on 2026-04-11 when the POS went native — so every
// report that depended on it has shown zero sales since. This module reads the
// live channels the consumption engine reads (consumption-post.ts):
//
//   pos_order_items / pos_orders   POS counter + GrabFood (source = 'grabfood')
//   order_items / orders           customer webapp: table-QR dine-in + pickup
//
// Menu resolution prefers the catalog link (Menu.storehubId = product_id, the
// native POS reused StoreHub product ids) and falls back to a name join;
// LATERAL + LIMIT 1 so a line can never fan out across two menus. Both tables
// store money in cents.

export type SoldLine = {
  outletId: string;          // Outlet uuid
  orderId: string;
  menuId: string | null;     // null = unmapped line (reported, never costed)
  productName: string;
  qty: number;               // net of refunds
  revenue: number;           // RM, line total net of line discounts
  modifiers: unknown;        // raw column; recipe-expand normalises both shapes
  orderType: string | null;  // dine_in | takeaway | pickup
  source: string | null;     // pos | grabfood | web_qr | app_ios | ...
};

// Money-received statuses for the pickup `orders` table (mirrors
// PICKUP_PAID_STATUSES in api/sales/_lib/unified-sales.ts).
const PICKUP_STATUSES = ["paid", "preparing", "ready", "collected", "completed"];

export async function fetchSoldLines(opts: {
  outletIds?: string[];
  from: Date;
  to: Date;
}): Promise<SoldLine[]> {
  const outlets = await prisma.outlet.findMany({
    where: opts.outletIds?.length ? { id: { in: opts.outletIds } } : undefined,
    select: { id: true, loyaltyOutletId: true, pickupStoreId: true },
  });
  const posSlugs = outlets.map((o) => o.loyaltyOutletId).filter((s): s is string => !!s);
  const storeIds = outlets.map((o) => o.pickupStoreId).filter((s): s is string => !!s);
  if (posSlugs.length === 0 && storeIds.length === 0) return [];

  const rows = await prisma.$queryRaw<Array<{
    outlet_id: string; order_id: string; menu_id: string | null; product_name: string;
    qty: number; revenue: number; modifiers: unknown; order_type: string | null; source: string | null;
  }>>`
    SELECT ol.id AS outlet_id,
           o.id::text AS order_id,
           m.id AS menu_id,
           i.product_name,
           (i.quantity - COALESCE(i.refunded_quantity, 0))::float AS qty,
           (COALESCE(i.item_total, i.unit_price * i.quantity) / 100.0)::float AS revenue,
           i.modifiers,
           o.order_type,
           o.source
    FROM pos_order_items i
    JOIN pos_orders o ON o.id = i.order_id
    JOIN "Outlet" ol ON ol."loyaltyOutletId" = o.outlet_id
    LEFT JOIN LATERAL (
      SELECT mm.id FROM "Menu" mm
      WHERE mm."storehubId" = i.product_id
         OR lower(btrim(mm.name)) = lower(btrim(i.product_name))
      ORDER BY (mm."storehubId" = i.product_id) DESC, mm."isActive" DESC, mm."updatedAt" DESC
      LIMIT 1
    ) m ON true
    WHERE o.outlet_id = ANY(${posSlugs})
      AND o.status = 'completed' AND o.refund_of_order_id IS NULL
      AND o.created_at >= ${opts.from} AND o.created_at < ${opts.to}
    UNION ALL
    SELECT ol.id,
           o.id::text,
           m.id,
           i.product_name,
           i.quantity::float,
           (COALESCE(i.item_total, i.unit_price * i.quantity) / 100.0)::float,
           i.modifiers,
           o.order_type,
           o.source
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    JOIN "Outlet" ol ON ol."pickupStoreId" = o.store_id
    LEFT JOIN LATERAL (
      SELECT mm.id FROM "Menu" mm
      WHERE mm."storehubId" = i.product_id
         OR lower(btrim(mm.name)) = lower(btrim(i.product_name))
      ORDER BY (mm."storehubId" = i.product_id) DESC, mm."isActive" DESC, mm."updatedAt" DESC
      LIMIT 1
    ) m ON true
    WHERE o.store_id = ANY(${storeIds})
      AND o.status = ANY(${PICKUP_STATUSES})
      AND o.created_at >= ${opts.from} AND o.created_at < ${opts.to}`;

  return rows.map((r) => ({
    outletId: r.outlet_id,
    orderId: r.order_id,
    menuId: r.menu_id,
    productName: r.product_name,
    qty: Number(r.qty),
    revenue: Number(r.revenue),
    modifiers: r.modifiers,
    orderType: r.order_type,
    source: r.source,
  }));
}

/** Recipe serviceMode gate for a sold line. Grab is fulfilled in takeaway packaging. */
export function toServiceMode(line: Pick<SoldLine, "orderType" | "source">): "DINE_IN" | "TAKEAWAY" | null {
  if (line.source === "grabfood") return "TAKEAWAY";
  if (line.orderType === "dine_in") return "DINE_IN";
  if (line.orderType === "takeaway" || line.orderType === "pickup") return "TAKEAWAY";
  return null;
}

// ── Costing: the catalog BOM page's cost basis ────────────────────────────
// Cheapest ACTIVE non-ADHOC SupplierProduct price ÷ package conversion factor,
// per product — identical to /api/inventory/menus and the menu_margins view.
// Rows with no package mapping or a non-positive factor are skipped (a package-
// less "RM 61 for 1L" would read as RM 61/ml).
export async function loadCatalogCostMap(): Promise<Map<string, number>> {
  const rows = await prisma.supplierProduct.findMany({
    where: { isActive: true, price: { gt: 0 }, supplier: { supplierCode: { not: "ADHOC" } } },
    select: { productId: true, price: true, productPackage: { select: { conversionFactor: true } } },
  });
  const costMap = new Map<string, number>();
  for (const sp of rows) {
    const conv = sp.productPackage ? Number(sp.productPackage.conversionFactor) : 0;
    if (conv <= 0) continue;
    const costPerBase = Number(sp.price) / conv;
    const existing = costMap.get(sp.productId);
    if (!existing || costPerBase < existing) costMap.set(sp.productId, costPerBase);
  }
  return costMap;
}

// ── Packaging rules ───────────────────────────────────────────────────────
// Cups, lids, straws and boxes live in PackagingRule (Inventory → Packaging),
// not in the recipe BOM. A per-item rule fires for every matching sold line;
// a per-order rule (Grab carrier bag) fires once per matching order.

export type PackagingRuleLite = {
  productId: string;
  quantity: number;
  scope: "ALL" | "CATEGORY" | "ITEMS";
  category: string | null;
  menuIds: string[];
  channel: "ALL" | "DINE_IN" | "TAKEAWAY" | "GRAB" | "DELIVERY";
  modifier: string | null;
  perOrder: boolean;
};

export async function loadPackagingRules(): Promise<PackagingRuleLite[]> {
  const rules = await prisma.packagingRule.findMany({
    where: { isActive: true },
    select: { productId: true, quantity: true, scope: true, category: true, menuIds: true, channel: true, modifier: true, perOrder: true },
  });
  return rules.map((r) => ({ ...r, quantity: Number(r.quantity) }));
}

export function ruleAppliesToMenu(rule: PackagingRuleLite, menu: { id: string; category: string | null }): boolean {
  if (rule.scope === "ALL") return true;
  if (rule.scope === "CATEGORY") return (menu.category ?? "") === (rule.category ?? "");
  return rule.menuIds.includes(menu.id);
}

/** Does a rule's channel match how this line was fulfilled? */
export function ruleAppliesToChannel(rule: PackagingRuleLite, line: Pick<SoldLine, "orderType" | "source">): boolean {
  const isGrab = line.source === "grabfood";
  switch (rule.channel) {
    case "ALL": return true;
    case "GRAB": return isGrab;
    case "DELIVERY": return false; // no delivery channel is wired into sales today
    case "TAKEAWAY": return toServiceMode(line) === "TAKEAWAY";
    case "DINE_IN": return toServiceMode(line) === "DINE_IN";
  }
}

/** Per-item packaging consumed by one sold line (base units, keyed by product). */
export function expandPackagingForLine(
  line: Pick<SoldLine, "qty" | "modifiers" | "orderType" | "source">,
  menu: { id: string; category: string | null },
  rules: PackagingRuleLite[],
): Map<string, number> {
  const mods = new Set(normaliseModifiers(line.modifiers));
  const out = new Map<string, number>();
  for (const r of rules) {
    if (r.perOrder) continue;
    if (!ruleAppliesToMenu(r, menu)) continue;
    if (!ruleAppliesToChannel(r, line)) continue;
    if (r.modifier && !mods.has(r.modifier)) continue;
    const qty = r.quantity * line.qty;
    if (qty === 0) continue;
    out.set(r.productId, (out.get(r.productId) ?? 0) + qty);
  }
  return out;
}

/**
 * Per-order packaging (carrier bags) across a set of sold lines: a per-order
 * rule fires once per distinct order whose channel matches and which contains
 * at least one line the rule's scope covers.
 */
export function expandPerOrderPackaging(
  lines: SoldLine[],
  menuById: Map<string, { id: string; category: string | null }>,
  rules: PackagingRuleLite[],
): Map<string, number> {
  const out = new Map<string, number>();
  const perOrderRules = rules.filter((r) => r.perOrder);
  if (perOrderRules.length === 0) return out;
  const fired = new Set<string>(); // `${orderId}|${ruleIdx}`
  for (const l of lines) {
    const menu = l.menuId ? menuById.get(l.menuId) : undefined;
    perOrderRules.forEach((r, idx) => {
      const key = `${l.orderId}|${idx}`;
      if (fired.has(key)) return;
      if (!ruleAppliesToChannel(r, l)) return;
      if (r.scope !== "ALL" && (!menu || !ruleAppliesToMenu(r, menu))) return;
      fired.add(key);
      out.set(r.productId, (out.get(r.productId) ?? 0) + r.quantity);
    });
  }
  return out;
}

/** Ingredient usage for one sold line via the shared recipe expansion. */
export function expandIngredientsForLine(line: SoldLine, recipe: RecipeLine[]): Map<string, number> {
  return expandSoldLine({ units: line.qty, modifiers: line.modifiers, serviceMode: toServiceMode(line) }, recipe);
}

export function costOf(usage: Map<string, number>, costMap: Map<string, number>): number {
  let total = 0;
  for (const [productId, qty] of usage) total += qty * (costMap.get(productId) ?? 0);
  return total;
}
