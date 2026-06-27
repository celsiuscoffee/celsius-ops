import { NextResponse, NextRequest } from "next/server";
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { boundedReorderQty } from "@/lib/inventory/order-validation";

// GET /api/inventory/reorder-suggestions
// Items at/below their reorder point with NO open PO already covering them, grouped
// into a suggested DRAFT PO per (cheapest active supplier × outlet). The "Need
// ordering" workspace tab shows these for a human to review + create — the ASSIST
// counterpart to the exec's auto-ordering (suggest, don't auto-fire).

const OPEN_ORDER_STATUSES: OrderStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "CONFIRMED",
  "AWAITING_DELIVERY",
  "PARTIALLY_RECEIVED",
];

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
      select: {
        supplierId: true,
        productId: true,
        price: true,
        moq: true,
        productPackageId: true,
        supplier: { select: { name: true } },
        productPackage: { select: { conversionFactor: true, packageLabel: true } },
      },
    }),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true, shelfLifeDays: true } }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
  ]);

  // Cheapest active supplier per product (per base unit), with the full line info.
  type Cheapest = {
    supplierId: string;
    supplierName: string;
    price: number;
    moq: number;
    productPackageId: string | null;
    conv: number;
    packageLabel: string;
    unitCost: number;
  };
  const cheapest = new Map<string, Cheapest>();
  for (const sp of sps) {
    const conv = sp.productPackage ? Number(sp.productPackage.conversionFactor) || 1 : 1;
    const c = conv > 0 ? conv : 1;
    const unitCost = Number(sp.price) / c;
    const cur = cheapest.get(sp.productId);
    if (!cur || unitCost < cur.unitCost) {
      cheapest.set(sp.productId, {
        supplierId: sp.supplierId,
        supplierName: sp.supplier?.name ?? "?",
        price: Number(sp.price),
        moq: Number(sp.moq) || 0,
        productPackageId: sp.productPackageId,
        conv: c,
        packageLabel: sp.productPackage?.packageLabel ?? "unit",
        unitCost,
      });
    }
  }

  const stockMap = new Map<string, number>();
  for (const s of stocks) {
    const k = `${s.productId}_${s.outletId}`;
    stockMap.set(k, (stockMap.get(k) ?? 0) + Number(s.quantity));
  }
  const covered = new Set<string>();
  for (const l of openLines) if (l.order) covered.add(`${l.productId}_${l.order.outletId}`);
  const prodMap = new Map(products.map((p) => [p.id, p]));
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  type Line = {
    productId: string;
    productPackageId: string | null;
    name: string;
    qty: number;
    unitPrice: number;
    packageLabel: string;
    onHand: number;
    reorderPoint: number;
  };
  const groups = new Map<string, { supplierId: string; supplierName: string; outletId: string; outletName: string; items: Line[] }>();

  for (const par of pars) {
    const p = prodMap.get(par.productId);
    if (!p) continue;
    const key = `${par.productId}_${par.outletId}`;
    const stock = stockMap.get(key) ?? 0;
    const reorder = Number(par.reorderPoint);
    if (stock > reorder || covered.has(key)) continue;
    const c = cheapest.get(par.productId);
    if (!c) continue;
    const parLvl = Number(par.parLevel);
    const maxLvl = par.maxLevel != null ? Number(par.maxLevel) : null;
    const avgDaily = par.avgDailyUsage != null ? Number(par.avgDailyUsage) : 0;
    const needed = Math.max(parLvl - stock, 0);
    if (needed <= 0) continue;
    const { orderQty } = boundedReorderQty({
      neededBase: needed,
      conversionFactor: c.conv,
      moq: c.moq,
      headroomBase: maxLvl != null ? Math.max(maxLvl - stock, 0) : null,
      shelfUsableBase: p.shelfLifeDays && avgDaily > 0 ? p.shelfLifeDays * avgDaily : null,
    });
    if (orderQty <= 0) continue;
    const gkey = `${c.supplierId}_${par.outletId}`;
    let g = groups.get(gkey);
    if (!g) {
      g = { supplierId: c.supplierId, supplierName: c.supplierName, outletId: par.outletId, outletName: outletMap.get(par.outletId) ?? "?", items: [] };
      groups.set(gkey, g);
    }
    g.items.push({
      productId: par.productId,
      productPackageId: c.productPackageId,
      name: p.name,
      qty: orderQty,
      unitPrice: c.price,
      packageLabel: c.packageLabel,
      onHand: stock,
      reorderPoint: reorder,
    });
  }

  const out = [...groups.values()]
    .map((g) => ({
      ...g,
      items: g.items.sort((a, b) => a.name.localeCompare(b.name)),
      total: Math.round(g.items.reduce((s, i) => s + i.qty * i.unitPrice, 0) * 100) / 100,
      itemCount: g.items.length,
    }))
    .sort((a, b) => b.itemCount - a.itemCount);

  return NextResponse.json({
    groups: out,
    supplierCount: out.length,
    itemCount: out.reduce((s, g) => s + g.items.length, 0),
  });
}
