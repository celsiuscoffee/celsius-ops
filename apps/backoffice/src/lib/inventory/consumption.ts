import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";

// Consumption engine — turns menu sales into theoretical ingredient depletion
// (sales × recipe BOM). This is the missing half of stock accuracy: today stock
// only ever goes UP from receipts and down from manual wastage/transfers, never
// from sales, so par-level reorder runs off a quantity that drifts upward.
//
// SAFETY: shadow-mode by default. Live posting writes negative StockAdjustments
// + decrements StockBalance, but StockBalance is currently fragmented by package
// (receivings write package-keyed rows, consumption would write the base/null-
// package row), so the decrement is only correct once stock units are normalised
// to base UOM. Keep CONSUMPTION_ENGINE_ENABLED off until that lands; shadow mode
// computes + reports the numbers without touching stock.

export const DEFAULT_TAKEAWAY_RATIO = 0.5;

type RecipeLine = { productId: string; quantityUsed: number; serviceMode: "ALL" | "DINE_IN" | "TAKEAWAY" };

export function channelWeight(mode: "ALL" | "DINE_IN" | "TAKEAWAY", takeawayRatio = DEFAULT_TAKEAWAY_RATIO): number {
  return mode === "TAKEAWAY" ? takeawayRatio : mode === "DINE_IN" ? 1 - takeawayRatio : 1;
}

/**
 * Pure: given units sold per menu and each menu's recipe, return the theoretical
 * quantity consumed per ingredient product (in the recipe's UOM, assumed = base
 * UOM). Channel-weighted because StoreHub sales carry no per-line dine-in/takeaway.
 */
export function aggregateConsumption(
  salesByMenu: Map<string, number>,
  recipeMap: Map<string, RecipeLine[]>,
  takeawayRatio = DEFAULT_TAKEAWAY_RATIO,
): Map<string, number> {
  const consumed = new Map<string, number>();
  for (const [menuId, qtySold] of salesByMenu) {
    if (qtySold <= 0) continue;
    const recipe = recipeMap.get(menuId);
    if (!recipe) continue; // no BOM → can't attribute consumption
    for (const line of recipe) {
      const amount = qtySold * line.quantityUsed * channelWeight(line.serviceMode, takeawayRatio);
      consumed.set(line.productId, (consumed.get(line.productId) ?? 0) + amount);
    }
  }
  return consumed;
}

export type ConsumptionResult = {
  outletId: string;
  outletName: string;
  date: string; // YYYY-MM-DD (MYT)
  posted: boolean; // false in shadow mode
  alreadyPosted: boolean; // idempotency hit
  menusSold: number;
  menusWithoutRecipe: number;
  productsConsumed: number;
  lines: { productId: string; productName: string; baseUom: string; quantity: number }[];
};

// Marker written into StockAdjustment.reason so a re-run is idempotent and the
// posting is auditable / reversible.
const reasonMarker = (date: string) => `auto-consumption:${date}`;

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

/** MYT day window for a YYYY-MM-DD string → [startUtc, endUtc). MYT = UTC+8. */
export function mytDayWindow(date: string): { startUtc: Date; endUtc: Date } {
  const startUtc = new Date(`${date}T00:00:00+08:00`);
  const endUtc = new Date(startUtc.getTime() + 86_400_000);
  return { startUtc, endUtc };
}
