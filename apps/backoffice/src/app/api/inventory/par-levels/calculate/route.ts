import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

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
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
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

  // POS-native sales source (StoreHub retired). pos_orders.outlet_id is the
  // native/loyalty id (e.g. "outlet-con"); the inventory `outletId` here is the
  // Outlet uuid, so resolve across. The native POS reuses StoreHub product ids,
  // so pos_order_items.product_id maps to Menu.storehubId — the same join the
  // old StoreHub sync used to set SalesTransaction.menuId.
  const outletRow = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { loyaltyOutletId: true },
  });
  const loyaltyOutletId = outletRow?.loyaltyOutletId ?? null;

  // ── Parallel data fetches ──────────────────────────────────────────
  const [salesByMenuRaw, bom, supplierProducts, existingParLevels, productPackages] = await Promise.all([
    loyaltyOutletId
      ? prisma.$queryRaw<Array<{ menuId: string; quantity: number }>>`
          SELECT m.id AS "menuId", COALESCE(SUM(i.quantity), 0)::int AS quantity
          FROM pos_order_items i
          JOIN pos_orders o ON o.id = i.order_id
          JOIN "Menu" m ON m."storehubId" = i.product_id
          WHERE o.outlet_id = ${loyaltyOutletId}
            AND o.status = 'completed'
            AND o.refund_of_order_id IS NULL
            AND o.created_at >= ${since}
          GROUP BY m.id
        `
      : Promise.resolve([] as Array<{ menuId: string; quantity: number }>),
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
    // Get packages for each product (for rounding to whole packages)
    // Prefer bulk packages (those with containsPackageId) for purchase rounding
    prisma.productPackage.findMany({
      select: { productId: true, conversionFactor: true, isDefault: true, containsPackageId: true },
      orderBy: { conversionFactor: "desc" },
    }),
  ]);

  // Shape native rows like the old SalesTransaction.groupBy result + a units total.
  const salesByMenu = salesByMenuRaw.map((r) => ({ menuId: r.menuId, _sum: { quantity: Number(r.quantity) } }));
  const salesCount = salesByMenu.reduce((s, r) => s + (r._sum.quantity ?? 0), 0);

  if (salesCount === 0) {
    return NextResponse.json(
      {
        error: "No sales data found",
        message: `No POS sales for this outlet in the last ${lookbackDays} days.`,
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
  // Prefer bulk packages (containsPackageId set) for purchase rounding,
  // then default package, then largest package
  const packageMap: Record<string, number> = {};
  for (const pkg of productPackages) {
    const cf = Number(pkg.conversionFactor);
    if (!packageMap[pkg.productId]) {
      packageMap[pkg.productId] = cf;
    }
    // Prefer bulk packages (sorted by conversionFactor desc, so first bulk wins)
    if (pkg.containsPackageId && cf > 0) {
      packageMap[pkg.productId] = cf;
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
