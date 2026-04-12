import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// ─── Par Level Calculation ─────────────────────────────────────────────
//
// Formula:
//   reorderPoint = avgDailyUsage × (leadTimeDays + safetyDays)
//   parLevel     = avgDailyUsage × (leadTimeDays + safetyDays + coverageDays)
//   maxLevel     = parLevel × 1.5
//
// Where:
//   leadTimeDays  = from the product's cheapest supplier (or default 1)
//   safetyDays    = buffer for demand spikes (default 1)
//   coverageDays  = days of stock after reorder arrives (default 3)
//

const DEFAULT_SAFETY_DAYS = 1;
const DEFAULT_COVERAGE_DAYS = 3;
const DEFAULT_LEAD_TIME_DAYS = 1;
const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LEVEL_MULTIPLIER = 1.5;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    outletId,
    lookbackDays = DEFAULT_LOOKBACK_DAYS,
    safetyDays = DEFAULT_SAFETY_DAYS,
    coverageDays = DEFAULT_COVERAGE_DAYS,
  } = body;

  if (!outletId) {
    return NextResponse.json({ error: "outletId is required" }, { status: 400 });
  }

  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  // ── Parallel data fetches ──────────────────────────────────────────
  const [salesCount, salesByMenu, bom, supplierProducts, existingParLevels, productPackages] = await Promise.all([
    prisma.salesTransaction.count({
      where: { outletId, transactedAt: { gte: since } },
    }),
    prisma.salesTransaction.groupBy({
      by: ["menuId"],
      where: { outletId, transactedAt: { gte: since }, menuId: { not: null } },
      _sum: { quantity: true },
    }),
    prisma.menuIngredient.findMany({
      include: { menu: true, product: true },
    }),
    // Get lead times from suppliers (cheapest per product)
    prisma.supplierProduct.findMany({
      where: { isActive: true },
      select: {
        productId: true,
        price: true,
        supplier: { select: { leadTimeDays: true } },
        productPackage: { select: { conversionFactor: true } },
      },
    }),
    // Get existing par levels to preserve manual overrides
    prisma.parLevel.findMany({
      where: { outletId },
      select: { productId: true, parLevel: true, reorderPoint: true, maxLevel: true },
    }),
    // Get default package for each product (for rounding to whole packages)
    prisma.productPackage.findMany({
      select: { productId: true, conversionFactor: true, isDefault: true },
      orderBy: { isDefault: "desc" },
    }),
  ]);

  if (salesCount === 0) {
    return NextResponse.json(
      {
        error: "No sales data found",
        message: `No sales transactions for this outlet in the last ${lookbackDays} days. Import sales data from StoreHub first.`,
      },
      { status: 422 },
    );
  }

  // ── Avg daily sales per menu item ──────────────────────────────────
  const avgDailySalesByMenu: Record<string, number> = {};
  for (const row of salesByMenu) {
    if (row.menuId) {
      avgDailySalesByMenu[row.menuId] = (row._sum.quantity || 0) / lookbackDays;
    }
  }

  // ── Build lead time map: productId → shortest lead time ────────────
  const leadTimeMap: Record<string, number> = {};
  for (const sp of supplierProducts) {
    const lt = sp.supplier.leadTimeDays || DEFAULT_LEAD_TIME_DAYS;
    if (!leadTimeMap[sp.productId] || lt < leadTimeMap[sp.productId]) {
      leadTimeMap[sp.productId] = lt;
    }
  }

  // ── Calculate daily usage per product from BOM × sales ─────────────
  const usageByProduct: Record<
    string,
    { name: string; sku: string; baseUom: string; dailyUsage: number }
  > = {};

  for (const ingredient of bom) {
    const avgDailySales = avgDailySalesByMenu[ingredient.menuId];
    if (!avgDailySales) continue;

    const dailyUsageFromMenu = Number(ingredient.quantityUsed) * avgDailySales;

    if (!usageByProduct[ingredient.productId]) {
      usageByProduct[ingredient.productId] = {
        name: ingredient.product.name,
        sku: ingredient.product.sku,
        baseUom: ingredient.product.baseUom,
        dailyUsage: 0,
      };
    }
    usageByProduct[ingredient.productId].dailyUsage += dailyUsageFromMenu;
  }

  // ── Build package conversion map: productId → conversionFactor ─────
  // Use default package, or first package if none is default
  const packageMap: Record<string, number> = {};
  for (const pkg of productPackages) {
    // First package wins per product (sorted by isDefault desc)
    if (!packageMap[pkg.productId]) {
      packageMap[pkg.productId] = Number(pkg.conversionFactor);
    }
  }

  /** Round a base-UOM value UP to the nearest whole package */
  function roundToPackage(baseQty: number, productId: string): number {
    const cf = packageMap[productId];
    if (!cf || cf <= 0) return Math.ceil(baseQty);
    return Math.ceil(baseQty / cf) * cf;
  }

  // ── Calculate and upsert par levels ────────────────────────────────
  const results: { productId: string; name: string; dailyUsage: number; leadTime: number; reorderPoint: number; parLevel: number; maxLevel: number }[] = [];

  const upserts = Object.entries(usageByProduct)
    .map(([productId, data]) => {
      if (data.dailyUsage <= 0) return null;

      const leadTime = leadTimeMap[productId] || DEFAULT_LEAD_TIME_DAYS;
      // Calculate raw values in base UOM, then round up to whole packages
      const rawReorder = data.dailyUsage * (leadTime + safetyDays);
      const rawPar = data.dailyUsage * (leadTime + safetyDays + coverageDays);
      const rawMax = rawPar * MAX_LEVEL_MULTIPLIER;

      const reorderPoint = roundToPackage(rawReorder, productId);
      const parLevel = roundToPackage(rawPar, productId);
      const maxLevel = roundToPackage(rawMax, productId);

      results.push({
        productId,
        name: data.name,
        dailyUsage: Math.round(data.dailyUsage * 100) / 100,
        leadTime,
        reorderPoint,
        parLevel,
        maxLevel,
      });

      return prisma.parLevel.upsert({
        where: { productId_outletId: { productId, outletId } },
        create: {
          productId,
          outletId,
          parLevel,
          reorderPoint,
          maxLevel,
          avgDailyUsage: Math.round(data.dailyUsage * 100) / 100,
          lastCalculated: new Date(),
        },
        update: {
          parLevel,
          reorderPoint,
          maxLevel,
          avgDailyUsage: Math.round(data.dailyUsage * 100) / 100,
          lastCalculated: new Date(),
        },
      });
    })
    .filter(Boolean);

  await Promise.all(upserts);

  return NextResponse.json({
    success: true,
    salesTransactions: salesCount,
    menuItemsWithSales: Object.keys(avgDailySalesByMenu).length,
    productsUpdated: upserts.length,
    lookbackDays,
    settings: { safetyDays, coverageDays },
    // Return details so UI can show the breakdown
    details: results.sort((a, b) => a.name.localeCompare(b.name)),
  });
}
