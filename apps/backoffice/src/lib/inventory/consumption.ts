// Consumption engine — PURE core. No DB imports so it unit-tests cleanly under
// vitest (the resolver doesn't alias "@/lib/*"). DB orchestration lives in
// consumption-post.ts.
//
// Turns menu sales into theoretical ingredient depletion (sales × recipe BOM) —
// the missing half of stock accuracy: today stock only ever goes UP from
// receipts and down from manual wastage/transfers, never from sales, so
// par-level reorder runs off a quantity that drifts upward.

export const DEFAULT_TAKEAWAY_RATIO = 0.5;

export type RecipeLine = { productId: string; quantityUsed: number; serviceMode: "ALL" | "DINE_IN" | "TAKEAWAY" };

export type ConsumptionResult = {
  outletId: string;
  outletName: string;
  date: string; // YYYY-MM-DD (MYT)
  posted: boolean; // false in shadow mode
  alreadyPosted: boolean; // idempotency hit
  menusSold: number;
  menusWithoutRecipe: number;
  itemsUnmapped: number; // items sold whose product_id maps to no Menu row
  productsConsumed: number;
  lines: { productId: string; productName: string; baseUom: string; quantity: number }[];
};

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

// Marker written into StockAdjustment.reason so a re-run is idempotent and the
// posting is auditable / reversible.
export const reasonMarker = (date: string) => `auto-consumption:${date}`;

/** MYT day window for a YYYY-MM-DD string → [startUtc, endUtc). MYT = UTC+8. */
export function mytDayWindow(date: string): { startUtc: Date; endUtc: Date } {
  const startUtc = new Date(`${date}T00:00:00+08:00`);
  const endUtc = new Date(startUtc.getTime() + 86_400_000);
  return { startUtc, endUtc };
}
