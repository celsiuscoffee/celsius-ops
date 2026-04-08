import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const WASTE_TYPES = [
  "WASTAGE",
  "BREAKAGE",
  "EXPIRED",
  "SPILLAGE",
  "THEFT",
  "USED_NOT_RECORDED",
] as const;

/**
 * GET /api/inventory/reports/wastage?outletId=xxx&from=ISO&to=ISO
 * Returns wastage report: aggregated by outlet, type, product + detailed items.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const outletId = params.get("outletId") || undefined;

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);

  const from = params.get("from") ? new Date(params.get("from")!) : defaultFrom;
  const to = params.get("to") ? new Date(params.get("to")!) : now;

  // Ensure 'to' covers the full day
  if (to.getHours() === 0 && to.getMinutes() === 0) {
    to.setHours(23, 59, 59, 999);
  }

  const [adjustments, supplierProducts, outlets] = await Promise.all([
    prisma.stockAdjustment.findMany({
      where: {
        adjustmentType: { in: [...WASTE_TYPES] },
        createdAt: { gte: from, lte: to },
        ...(outletId ? { outletId } : {}),
      },
      include: {
        product: {
          select: {
            name: true,
            sku: true,
            baseUom: true,
            category: { select: { name: true } },
          },
        },
        outlet: { select: { name: true } },
        adjustedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),

    // Supplier prices -- cheapest active price per product (same pattern as stock-valuation)
    prisma.supplierProduct.findMany({
      where: { isActive: true },
      select: {
        productId: true,
        price: true,
        productPackage: { select: { conversionFactor: true } },
      },
    }),

    prisma.outlet.findMany({
      select: { id: true, name: true },
    }),
  ]);

  // Build cost-per-base-unit map (cheapest supplier price / conversion factor)
  const costMap = new Map<string, number>();
  for (const sp of supplierProducts) {
    const conversion = sp.productPackage?.conversionFactor
      ? Number(sp.productPackage.conversionFactor)
      : 1;
    const costPerBase = Number(sp.price) / conversion;
    const existing = costMap.get(sp.productId);
    if (!existing || costPerBase < existing) {
      costMap.set(sp.productId, costPerBase);
    }
  }

  // Resolve cost for each adjustment
  const resolvedItems = adjustments.map((adj) => {
    const qty = Math.abs(Number(adj.quantity));
    const cost =
      adj.costAmount !== null
        ? Math.abs(Number(adj.costAmount))
        : qty * (costMap.get(adj.productId) ?? 0);

    return {
      id: adj.id,
      date: adj.createdAt.toISOString(),
      outletId: adj.outletId,
      outletName: adj.outlet.name,
      productId: adj.productId,
      productName: adj.product.name,
      sku: adj.product.sku,
      category: adj.product.category.name,
      baseUom: adj.product.baseUom,
      type: adj.adjustmentType,
      quantity: qty,
      cost: Math.round(cost * 100) / 100,
      reason: adj.reason,
      adjustedBy: adj.adjustedBy.name,
    };
  });

  // --- Aggregations ---

  // By outlet
  const outletAgg = new Map<string, { outletName: string; totalQty: number; totalCost: number; adjustmentCount: number }>();
  for (const item of resolvedItems) {
    const entry = outletAgg.get(item.outletId) ?? { outletName: item.outletName, totalQty: 0, totalCost: 0, adjustmentCount: 0 };
    entry.totalQty += item.quantity;
    entry.totalCost += item.cost;
    entry.adjustmentCount += 1;
    outletAgg.set(item.outletId, entry);
  }

  // By type
  const typeAgg = new Map<string, { type: string; totalQty: number; totalCost: number; count: number }>();
  for (const item of resolvedItems) {
    const entry = typeAgg.get(item.type) ?? { type: item.type, totalQty: 0, totalCost: 0, count: 0 };
    entry.totalQty += item.quantity;
    entry.totalCost += item.cost;
    entry.count += 1;
    typeAgg.set(item.type, entry);
  }

  // By product
  const productAgg = new Map<string, { productName: string; sku: string; totalQty: number; totalCost: number; count: number }>();
  for (const item of resolvedItems) {
    const entry = productAgg.get(item.productId) ?? { productName: item.productName, sku: item.sku, totalQty: 0, totalCost: 0, count: 0 };
    entry.totalQty += item.quantity;
    entry.totalCost += item.cost;
    entry.count += 1;
    productAgg.set(item.productId, entry);
  }

  // Summary
  const totalWasteQty = resolvedItems.reduce((s, i) => s + i.quantity, 0);
  const totalWasteCost = resolvedItems.reduce((s, i) => s + i.cost, 0);
  const affectedProducts = new Set(resolvedItems.map((i) => i.productId)).size;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return NextResponse.json({
    summary: {
      totalWasteQty: round2(totalWasteQty),
      totalWasteCost: round2(totalWasteCost),
      adjustmentCount: resolvedItems.length,
      affectedProducts,
    },
    outlets,
    byOutlet: Array.from(outletAgg.values()).map((o) => ({
      ...o,
      totalQty: round2(o.totalQty),
      totalCost: round2(o.totalCost),
    })),
    byType: Array.from(typeAgg.values()).map((t) => ({
      ...t,
      totalQty: round2(t.totalQty),
      totalCost: round2(t.totalCost),
    })),
    byProduct: Array.from(productAgg.values())
      .map((p) => ({
        ...p,
        totalQty: round2(p.totalQty),
        totalCost: round2(p.totalCost),
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 20),
    items: resolvedItems,
  });
}
