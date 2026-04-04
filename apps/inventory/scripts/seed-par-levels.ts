/**
 * Calculate and set par levels based on real BOM × real sales data.
 *
 * Formula:
 *   dailyUsage(product) = Σ (BOM qty per serving × avg daily sales of that menu item)
 *   parLevel     = ceil(dailyUsage × PAR_DAYS)
 *   reorderPoint = ceil(dailyUsage × REORDER_DAYS)
 *
 * Sales data comes from `SalesTransaction` (synced from StoreHub).
 * BOM data comes from `MenuIngredient`.
 *
 * If no sales data exists, this script will report it and exit — it never assumes.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAR_DAYS = 3; // Keep 3 days of stock
const REORDER_DAYS = 1; // Reorder when 1 day of stock left
const LOOKBACK_DAYS = 30; // Use last 30 days of sales to calculate avg daily usage

async function main() {
  const outletId = process.argv[2];
  if (!outletId) {
    const outlets = await prisma.outlet.findMany({
      select: { id: true, name: true },
    });
    console.log(
      "Usage: npx tsx scripts/seed-par-levels.ts <outletId> [lookbackDays]",
    );
    console.log("\nAvailable outlets:");
    outlets.forEach((b) => console.log(`  ${b.id} - ${b.name}`));
    process.exit(1);
  }

  const lookbackDays = Number(process.argv[3]) || LOOKBACK_DAYS;

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
  if (!outlet) {
    console.error("Outlet not found:", outletId);
    process.exit(1);
  }
  console.log(`\nCalculating par levels for: ${outlet.name}`);
  console.log(`Using last ${lookbackDays} days of sales data\n`);

  // 1. Check if we have any sales data
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const salesCount = await prisma.salesTransaction.count({
    where: {
      outletId,
      transactedAt: { gte: since },
    },
  });

  if (salesCount === 0) {
    console.error("❌ No sales data found for this outlet in the last", lookbackDays, "days.");
    console.error("   Import sales data from StoreHub first, then re-run this script.");
    console.error("\n   The SalesTransaction table needs records with:");
    console.error("   - outletId, menuId, quantity, transactedAt");
    process.exit(1);
  }

  console.log(`Found ${salesCount} sales transactions since ${since.toISOString().split("T")[0]}\n`);

  // 2. Calculate avg daily sales per menu item from real transactions
  const salesByMenu = await prisma.salesTransaction.groupBy({
    by: ["menuId"],
    where: {
      outletId,
      transactedAt: { gte: since },
      menuId: { not: null },
    },
    _sum: { quantity: true },
  });

  const avgDailySalesByMenu: Record<string, number> = {};
  for (const row of salesByMenu) {
    if (row.menuId) {
      avgDailySalesByMenu[row.menuId] = (row._sum.quantity || 0) / lookbackDays;
    }
  }

  console.log(`Menu items with sales data: ${Object.keys(avgDailySalesByMenu).length}`);

  // 3. Get BOM data — how much of each product is used per serving of each menu
  const bom = await prisma.menuIngredient.findMany({
    include: { menu: true, product: true },
  });

  // 4. Calculate daily usage per product = Σ (BOM qty × avg daily menu sales)
  const usageByProduct: Record<
    string,
    { name: string; sku: string; baseUom: string; dailyUsage: number; sources: string[] }
  > = {};

  for (const ingredient of bom) {
    const avgDailySales = avgDailySalesByMenu[ingredient.menuId];
    if (!avgDailySales) continue; // No sales data for this menu item

    const dailyUsageFromMenu = Number(ingredient.quantityUsed) * avgDailySales;

    if (!usageByProduct[ingredient.productId]) {
      usageByProduct[ingredient.productId] = {
        name: ingredient.product.name,
        sku: ingredient.product.sku,
        baseUom: ingredient.product.baseUom,
        dailyUsage: 0,
        sources: [],
      };
    }
    usageByProduct[ingredient.productId].dailyUsage += dailyUsageFromMenu;
    usageByProduct[ingredient.productId].sources.push(
      `${ingredient.menu.name}: ${avgDailySales.toFixed(1)}/day × ${ingredient.quantityUsed} ${ingredient.product.baseUom}`,
    );
  }

  if (Object.keys(usageByProduct).length === 0) {
    console.error("❌ No products matched: sales data exists but no BOM linkage found.");
    console.error("   Check that MenuIngredient records reference menus that have sales.");
    process.exit(1);
  }

  // 5. Upsert par levels
  let created = 0;
  let skipped = 0;

  for (const [productId, data] of Object.entries(usageByProduct)) {
    const parLevel = Math.ceil(data.dailyUsage * PAR_DAYS);
    const reorderPoint = Math.ceil(data.dailyUsage * REORDER_DAYS);

    if (parLevel === 0) {
      skipped++;
      continue;
    }

    await prisma.parLevel.upsert({
      where: {
        productId_outletId: { productId, outletId },
      },
      create: {
        productId,
        outletId,
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

    console.log(
      `  ${data.name} (${data.sku}): ${data.dailyUsage.toFixed(2)} ${data.baseUom}/day → par=${parLevel}, reorder=${reorderPoint}`,
    );
    for (const source of data.sources) {
      console.log(`    └ ${source}`);
    }
    created++;
  }

  const totalProducts = await prisma.product.count({ where: { isActive: true } });
  console.log(
    `\nDone! Set par levels for ${created} products (${skipped} skipped with zero usage, ${totalProducts - created - skipped} without BOM/sales data)`,
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
