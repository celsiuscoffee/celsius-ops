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
// Money-received statuses for the pickup `orders` table (mirrors
// PICKUP_PAID_STATUSES in api/sales/_lib/unified-sales.ts): a paid order is
// prepared, so its ingredients are consumed even if not yet collected.
const PICKUP_STATUSES = ["paid", "preparing", "ready", "collected", "completed"];

export async function postOutletConsumption(opts: {
  outletId: string;
  outletName: string;
  // POS-native slug (pos_orders.outlet_id, e.g. "outlet-sa") — Outlet.loyaltyOutletId.
  loyaltyOutletId?: string | null;
  // Pickup app store id (orders.store_id) — Outlet.pickupStoreId.
  pickupStoreId?: string | null;
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

  // Live sales for the MYT day: POS-native + pickup app, both mapped to Menu
  // via Menu.storehubId = item.product_id (same join as the demand model,
  // lib/hr/demand.ts). menu_id NULL = item sold that maps to no Menu row —
  // surfaced as itemsUnmapped instead of silently dropped.
  const sales = await prisma.$queryRaw<{ menu_id: string | null; qty: number }[]>`
    SELECT u.menu_id, SUM(u.qty)::float AS qty FROM (
      SELECT m.id AS menu_id, i.quantity::float AS qty
      FROM pos_order_items i
      JOIN pos_orders o ON o.id = i.order_id
      LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
      WHERE o.outlet_id = ${opts.loyaltyOutletId ?? ""}
        AND o.status = 'completed' AND o.refund_of_order_id IS NULL
        AND o.created_at >= ${dayStartUtc} AND o.created_at < ${dayEndUtc}
      UNION ALL
      SELECT m.id, i.quantity::float
      FROM order_items i
      JOIN orders o ON o.id = i.order_id
      LEFT JOIN "Menu" m ON m."storehubId" = i.product_id
      WHERE o.store_id = ${opts.pickupStoreId ?? ""}
        AND o.status = ANY(${PICKUP_STATUSES})
        AND o.created_at >= ${dayStartUtc} AND o.created_at < ${dayEndUtc}
    ) u GROUP BY u.menu_id`;
  const salesByMenu = new Map<string, number>();
  let itemsUnmapped = 0;
  for (const s of sales) {
    if (s.menu_id) salesByMenu.set(s.menu_id, (salesByMenu.get(s.menu_id) ?? 0) + Number(s.qty));
    else itemsUnmapped += Number(s.qty);
  }

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
    itemsUnmapped,
    productsConsumed: lines.length,
    lines,
  };
}
