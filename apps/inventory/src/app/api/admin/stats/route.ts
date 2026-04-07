import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/stats
 * Returns all dashboard counts + financial metrics in a single query batch.
 */
export async function GET() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    products,
    suppliers,
    categories,
    outlets,
    staff,
    menus,
    invoices,
    pendingInvoiceAgg,
    overdueInvoiceAgg,
    stockBalances,
    supplierProducts,
    monthlySales,
    menuIngredients,
    latestStockCount,
  ] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.supplier.count({ where: { status: "ACTIVE" } }),
    prisma.category.count(),
    prisma.outlet.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.menu.count({ where: { isActive: true } }),
    prisma.invoice.count(),
    prisma.invoice.aggregate({
      where: { status: "PENDING" },
      _sum: { amount: true },
    }),
    prisma.invoice.aggregate({
      where: { status: "OVERDUE" },
      _sum: { amount: true },
    }),
    // Stock balances for asset value (only non-zero)
    prisma.stockBalance.findMany({
      where: { quantity: { gt: 0 } },
      select: { productId: true, quantity: true },
    }),
    // Supplier prices for cost calculation (only cheapest per product via distinct)
    prisma.supplierProduct.findMany({
      where: { isActive: true },
      select: {
        productId: true,
        price: true,
        productPackage: { select: { conversionFactor: true } },
      },
    }),
    // This month's sales for COGS (limited to current month)
    prisma.salesTransaction.findMany({
      where: { transactedAt: { gte: monthStart } },
      select: { menuId: true, quantity: true },
    }),
    // Menu ingredients for COGS calculation (only for menus sold this month — filtered after)
    prisma.menuIngredient.findMany({
      select: { menuId: true, productId: true, quantityUsed: true },
    }),
    // Latest stock count for expected vs real
    prisma.stockCount.findFirst({
      orderBy: { countDate: "desc" },
      select: {
        countDate: true,
        outletId: true,
        outlet: { select: { name: true } },
        items: {
          select: { productId: true, expectedQty: true, countedQty: true },
        },
      },
    }),
  ]);

  // ── Inventory Asset Value ──
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
  let inventoryValue = 0;
  for (const bal of stockBalances) {
    const cost = costMap.get(bal.productId) ?? 0;
    inventoryValue += Number(bal.quantity) * cost;
  }

  // ── COGS (this month) ──
  // Group ingredient usage by product from sales
  const ingredientMap = new Map<string, Map<string, number>>(); // menuId -> productId -> qtyPerItem
  for (const ing of menuIngredients) {
    if (!ingredientMap.has(ing.menuId)) ingredientMap.set(ing.menuId, new Map());
    ingredientMap.get(ing.menuId)!.set(ing.productId, Number(ing.quantityUsed));
  }
  let cogsTotal = 0;
  for (const sale of monthlySales) {
    if (!sale.menuId) continue;
    const ings = ingredientMap.get(sale.menuId);
    if (!ings) continue;
    for (const [productId, qtyPerItem] of ings) {
      const cost = costMap.get(productId) ?? 0;
      cogsTotal += qtyPerItem * sale.quantity * cost;
    }
  }

  // ── Expected vs Real (from latest stock count) ──
  let expectedVsReal = null;
  if (latestStockCount && latestStockCount.items.length > 0) {
    let totalExpected = 0;
    let totalCounted = 0;
    let itemsWithVariance = 0;
    for (const item of latestStockCount.items) {
      const expected = item.expectedQty ? Number(item.expectedQty) : 0;
      const counted = item.countedQty ? Number(item.countedQty) : 0;
      const cost = costMap.get(item.productId) ?? 0;
      totalExpected += expected * cost;
      totalCounted += counted * cost;
      if (counted !== expected) itemsWithVariance++;
    }
    expectedVsReal = {
      expectedValue: Math.round(totalExpected * 100) / 100,
      realValue: Math.round(totalCounted * 100) / 100,
      difference: Math.round((totalCounted - totalExpected) * 100) / 100,
      itemsWithVariance,
      totalItems: latestStockCount.items.length,
      countDate: latestStockCount.countDate.toISOString(),
      outlet: latestStockCount.outlet.name,
    };
  }

  return NextResponse.json({
    products,
    suppliers,
    categories,
    outlets,
    staff,
    menus,
    invoices: {
      total: invoices,
      pendingAmount: Number(pendingInvoiceAgg._sum.amount ?? 0),
      overdueAmount: Number(overdueInvoiceAgg._sum.amount ?? 0),
    },
    inventoryValue: Math.round(inventoryValue * 100) / 100,
    cogsThisMonth: Math.round(cogsTotal * 100) / 100,
    expectedVsReal,
  });
}
