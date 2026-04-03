import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const PAR_DAYS = 3;
const REORDER_DAYS = 1;
const DEFAULT_LOOKBACK_DAYS = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { branchId, lookbackDays = DEFAULT_LOOKBACK_DAYS } = body;

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  // Check for sales data
  const salesCount = await prisma.salesTransaction.count({
    where: { branchId, transactedAt: { gte: since } },
  });

  if (salesCount === 0) {
    return NextResponse.json(
      {
        error: "No sales data found",
        message: `No sales transactions for this branch in the last ${lookbackDays} days. Import sales data from StoreHub first.`,
      },
      { status: 422 },
    );
  }

  // Avg daily sales per menu item
  const salesByMenu = await prisma.salesTransaction.groupBy({
    by: ["menuId"],
    where: { branchId, transactedAt: { gte: since }, menuId: { not: null } },
    _sum: { quantity: true },
  });

  const avgDailySalesByMenu: Record<string, number> = {};
  for (const row of salesByMenu) {
    if (row.menuId) {
      avgDailySalesByMenu[row.menuId] = (row._sum.quantity || 0) / lookbackDays;
    }
  }

  // BOM data
  const bom = await prisma.menuIngredient.findMany({
    include: { menu: true, product: true },
  });

  // Calculate daily usage per product
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

  // Upsert par levels (batched in parallel)
  const upserts = Object.entries(usageByProduct)
    .map(([productId, data]) => {
      const parLevel = Math.ceil(data.dailyUsage * PAR_DAYS);
      const reorderPoint = Math.ceil(data.dailyUsage * REORDER_DAYS);
      if (parLevel === 0) return null;
      return prisma.parLevel.upsert({
        where: { productId_branchId: { productId, branchId } },
        create: {
          productId,
          branchId,
          parLevel,
          reorderPoint,
          avgDailyUsage: Math.round(data.dailyUsage * 100) / 100,
          lastCalculated: new Date(),
        },
        update: {
          parLevel,
          reorderPoint,
          avgDailyUsage: Math.round(data.dailyUsage * 100) / 100,
          lastCalculated: new Date(),
        },
      });
    })
    .filter(Boolean);
  await Promise.all(upserts);
  const updated = upserts.length;

  return NextResponse.json({
    success: true,
    salesTransactions: salesCount,
    menuItemsWithSales: Object.keys(avgDailySalesByMenu).length,
    productsUpdated: updated,
    lookbackDays,
  });
}
