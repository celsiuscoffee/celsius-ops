import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { aggregateConsumption, reasonMarker, type ConsumptionResult, type RecipeLine } from "@/lib/inventory/consumption";

// DB orchestration for the consumption engine (pure core in consumption.ts).
//
// SAFETY: shadow by default. Live posting writes negative StockAdjustments +
// decrements StockBalance, but StockBalance is currently fragmented by package
// (receivings write package-keyed rows, consumption would write the base/null-
// package row), so the decrement is only correct once stock units are normalised
// to base UOM. Keep CONSUMPTION_ENGINE_ENABLED off until then.

/**
 * Compute (and, when live, post) one outlet's consumption for a single MYT day.
 * `[dayStartUtc, dayEndUtc)` must bound that MYT day. Never throws on a single
 * outlet — caller aggregates results.
 */
export async function postOutletConsumption(opts: {
  outletId: string;
  outletName: string;
  date: string;
  dayStartUtc: Date;
  dayEndUtc: Date;
  live: boolean;
  systemUserId?: string | null; // required to post live (StockAdjustment.adjustedById FK)
  takeawayRatio?: number;
}): Promise<ConsumptionResult> {
  const { outletId, outletName, date, dayStartUtc, dayEndUtc } = opts;
  // Live posting needs a real user for the adjustment's FK; without one we stay
  // in shadow mode no matter the flag.
  const live = opts.live && !!opts.systemUserId;

  const sales = await prisma.salesTransaction.findMany({
    where: { outletId, menuId: { not: null }, transactedAt: { gte: dayStartUtc, lt: dayEndUtc } },
    select: { menuId: true, quantity: true },
  });
  const salesByMenu = new Map<string, number>();
  for (const s of sales) if (s.menuId) salesByMenu.set(s.menuId, (salesByMenu.get(s.menuId) ?? 0) + s.quantity);

  const recipes = salesByMenu.size
    ? await prisma.menuIngredient.findMany({
        where: { menuId: { in: [...salesByMenu.keys()] } },
        select: { menuId: true, productId: true, quantityUsed: true, serviceMode: true },
      })
    : [];
  const recipeMap = new Map<string, RecipeLine[]>();
  for (const r of recipes) {
    const arr = recipeMap.get(r.menuId) ?? [];
    arr.push({ productId: r.productId, quantityUsed: Number(r.quantityUsed), serviceMode: r.serviceMode });
    recipeMap.set(r.menuId, arr);
  }
  const menusWithoutRecipe = [...salesByMenu.keys()].filter((m) => !recipeMap.has(m)).length;

  const consumed = aggregateConsumption(salesByMenu, recipeMap, opts.takeawayRatio);

  // Idempotency: did we already post this outlet+date?
  const already = await prisma.stockAdjustment.findFirst({
    where: { outletId, reason: reasonMarker(date) },
    select: { id: true },
  });
  const alreadyPosted = !!already;

  const productMeta = consumed.size
    ? await prisma.product.findMany({ where: { id: { in: [...consumed.keys()] } }, select: { id: true, name: true, baseUom: true } })
    : [];
  const metaById = new Map(productMeta.map((p) => [p.id, p]));

  const lines = [...consumed.entries()]
    .map(([productId, quantity]) => ({
      productId,
      productName: metaById.get(productId)?.name ?? "—",
      baseUom: metaById.get(productId)?.baseUom ?? "",
      quantity: Math.round(quantity * 10000) / 10000,
    }))
    .filter((l) => l.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);

  // Live posting (gated + idempotent). One StockAdjustment per product carrying
  // the marker, plus a base-unit stock decrement.
  if (live && !alreadyPosted && lines.length) {
    for (const l of lines) {
      await prisma.stockAdjustment.create({
        data: {
          outletId,
          productId: l.productId,
          adjustmentType: "USED_NOT_RECORDED",
          quantity: l.quantity,
          reason: reasonMarker(date),
          adjustedById: opts.systemUserId!,
        },
      });
      await adjustStockBalance(outletId, l.productId, -l.quantity, null);
    }
  }

  return {
    outletId,
    outletName,
    date,
    posted: live && !alreadyPosted && lines.length > 0,
    alreadyPosted,
    menusSold: salesByMenu.size,
    menusWithoutRecipe,
    productsConsumed: lines.length,
    lines,
  };
}
