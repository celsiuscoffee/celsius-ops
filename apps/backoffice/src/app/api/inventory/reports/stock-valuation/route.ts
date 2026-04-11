import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/reports/stock-valuation?outletId=xxx
 * Returns stock valuation: system qty, last counted qty, variance, and RM value per product.
 * If no outletId, returns all outlets aggregated.
 */
export async function GET(req: NextRequest) {
  const outletId = new URL(req.url).searchParams.get("outletId");

  const [balances, supplierProducts, lastCounts, outlets] = await Promise.all([
    // Stock balances (system expected qty)
    prisma.stockBalance.findMany({
      where: outletId ? { outletId } : undefined,
      select: {
        outletId: true,
        productId: true,
        quantity: true,
        lastUpdated: true,
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            baseUom: true,
            group: { select: { name: true } },
          },
        },
        outlet: { select: { id: true, name: true } },
      },
    }),

    // Supplier prices — pick cheapest active price per product
    prisma.supplierProduct.findMany({
      where: { isActive: true },
      select: {
        productId: true,
        price: true,
        productPackage: { select: { conversionFactor: true } },
      },
    }),

    // Latest stock count items per outlet — get most recent count per outlet
    prisma.stockCount.findMany({
      where: outletId ? { outletId } : undefined,
      orderBy: { countDate: "desc" },
      take: outletId ? 1 : 20,
      select: {
        outletId: true,
        countDate: true,
        items: {
          select: {
            productId: true,
            countedQty: true,
          },
        },
      },
    }),

    // All branches for filtering
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

  // Build last-counted map per outlet+product (from most recent count only)
  const countedMap = new Map<string, number>();
  const seenOutlets = new Set<string>();
  for (const count of lastCounts) {
    if (seenOutlets.has(count.outletId)) continue; // only take most recent per outlet
    seenOutlets.add(count.outletId);
    for (const item of count.items) {
      const key = `${count.outletId}:${item.productId}`;
      countedMap.set(key, item.countedQty ? Number(item.countedQty) : 0);
    }
  }

  // Build items
  const items = balances.map((bal) => {
    const systemQty = Number(bal.quantity);
    const costPerUnit = costMap.get(bal.productId) ?? 0;
    const countedKey = `${bal.outletId}:${bal.productId}`;
    const lastCountedQty = countedMap.get(countedKey) ?? null;
    const variance = lastCountedQty !== null ? lastCountedQty - systemQty : null;
    const systemValue = systemQty * costPerUnit;
    const countedValue = lastCountedQty !== null ? lastCountedQty * costPerUnit : null;

    return {
      productId: bal.productId,
      name: bal.product.name,
      sku: bal.product.sku,
      category: bal.product.group.name,
      baseUom: bal.product.baseUom,
      outletId: bal.outletId,
      outletName: bal.outlet.name,
      systemQty,
      lastCountedQty,
      variance,
      costPerUnit: Math.round(costPerUnit * 100) / 100,
      systemValue: Math.round(systemValue * 100) / 100,
      countedValue: countedValue !== null ? Math.round(countedValue * 100) / 100 : null,
      valueDiff: countedValue !== null ? Math.round((countedValue - systemValue) * 100) / 100 : null,
    };
  });

  // Sort by absolute variance value descending (biggest discrepancies first)
  items.sort((a, b) => Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0));

  // Summary
  const hasAnyCounts = items.some((i) => i.lastCountedQty !== null);
  const totalSystemValue = items.reduce((s, i) => s + i.systemValue, 0);
  const countedItems = items.filter((i) => i.countedValue !== null);
  const totalCountedValue = countedItems.reduce((s, i) => s + i.countedValue!, 0);
  const itemsWithVariance = items.filter((i) => i.variance !== null && i.variance !== 0);

  return NextResponse.json({
    summary: {
      totalProducts: items.length,
      totalSystemValue: Math.round(totalSystemValue * 100) / 100,
      totalCountedValue: hasAnyCounts ? Math.round(totalCountedValue * 100) / 100 : null,
      valueDifference: hasAnyCounts ? Math.round((totalCountedValue - totalSystemValue) * 100) / 100 : null,
      itemsWithVariance: itemsWithVariance.length,
      hasAnyCounts,
    },
    outlets,
    items,
  });
}
