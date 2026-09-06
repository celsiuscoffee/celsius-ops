import { prisma } from "@/lib/prisma";
import type { Prisma } from "@celsius/db";
import { reasonMarker, type ConsumptionResult } from "@/lib/inventory/consumption";
import { isOpenMytDay } from "@/lib/inventory/myt-date";
import { expandSoldLines, type RecipeLine as ExpandRecipeLine } from "@celsius/db";

// DB orchestration for the consumption engine (pure expansion in
// @celsius/db/recipe-expand, shared with the variance tooling).
//
// SAFETY: shadow by default. Live posting writes negative StockAdjustments +
// decrements StockBalance. Before arming, note that the POS DB trigger
// (pos_order_items_stock_ins → pos_apply_item_stock) ALREADY depletes stock at
// sale time for the POS channel — running both live would double-deduct. The
// plan of record (2026-08-17) is: validate this engine in shadow against the
// daily counts, then replace the trigger with it. Keep
// CONSUMPTION_ENGINE_ENABLED off until the trigger is dropped.
//
// Why this exists when the trigger does sale-time depletion: the trigger is
// POS-only (the customer app's `orders` are never depleted — 12–20% of
// ingredient demand), modifier-blind until the 2026-08-17 hotfix and modifier-
// ignoring after it, and writes no audit rows. This engine covers both
// channels, honours modifier scoping / oat substitution / service mode via
// expandSoldLine, and leaves a StockAdjustment per product per day.

/**
 * Compute (and, when live, post) one outlet's consumption for a single MYT day.
 * `[dayStartUtc, dayEndUtc)` must bound that MYT day. Never throws on a single
 * outlet — caller aggregates results.
 */
// Money-received statuses for the pickup `orders` table (mirrors
// PICKUP_PAID_STATUSES in api/sales/_lib/unified-sales.ts): a paid order is
// prepared, so its ingredients are consumed even if not yet collected.
const PICKUP_STATUSES = ["paid", "preparing", "ready", "collected", "completed"];

type SoldRow = {
  menu_id: string | null;
  qty: number;
  modifiers: unknown;
  order_type: string | null;
};

/**
 * Transaction-scoped twin of lib/stock adjustStockBalance(…, null): decrement
 * the CANONICAL per-product balance row (productPackageId null) in base units
 * and clamp at zero. Lives here because the shared helper binds the global
 * client and can't join the posting transaction.
 */
async function decrementCanonicalBalance(tx: Prisma.TransactionClient, outletId: string, productId: string, qty: number) {
  const existing = await tx.stockBalance.findFirst({
    where: { outletId, productId, productPackageId: null },
    select: { id: true },
  });
  if (existing) {
    await tx.stockBalance.update({
      where: { id: existing.id },
      data: { quantity: { decrement: qty }, lastUpdated: new Date() },
    });
  } else {
    await tx.stockBalance.create({
      data: { outletId, productId, productPackageId: null, quantity: 0, lastUpdated: new Date() },
    });
  }
  await tx.stockBalance.updateMany({
    where: { outletId, productId, productPackageId: null, quantity: { lt: 0 } },
    data: { quantity: 0 },
  });
}

/** Map a channel's order_type to the recipe serviceMode gate. */
function toServiceMode(orderType: string | null): "DINE_IN" | "TAKEAWAY" | null {
  if (orderType === "dine_in") return "DINE_IN";
  if (orderType === "takeaway" || orderType === "pickup") return "TAKEAWAY";
  return null; // unknown channel: serviceMode-scoped lines still apply (see expandSoldLine)
}

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
  /** @deprecated unused — both channels now carry a real per-order type. */
  takeawayRatio?: number;
}): Promise<ConsumptionResult> {
  const { outletId, outletName, date, dayStartUtc, dayEndUtc } = opts;
  // A day that has not closed in MYT is a PARTIAL day: posting it would lock a
  // fraction of the sales in as "the" consumption (the marker makes the day
  // idempotent, so the rest would never be posted). Refuse outright — the cron
  // defaults to yesterday, so only a manual ?date= can hit this.
  if (isOpenMytDay(date)) {
    throw new Error(`refusing to compute consumption for ${date}: MYT day not closed yet`);
  }
  // Live posting needs a real user for the adjustment's FK; without one we stay
  // in shadow mode no matter the flag.
  const live = opts.live && !!opts.systemUserId;

  // Per-LINE sales for the MYT day — not aggregated by menu, because the
  // modifiers on each line decide which recipe rows apply (temperature doses,
  // oat substitution, Extra Shot). Menu resolution prefers the catalog link
  // (Menu.storehubId = product_id) and falls back to the name join the
  // variance tooling validated at 99.3% unit coverage; LATERAL + LIMIT 1 so a
  // line can never fan out across two menus. POS quantities are net of
  // refunds; the app table has no partial refunds.
  const sales = await prisma.$queryRaw<SoldRow[]>`
    SELECT m.id AS menu_id,
           (i.quantity - COALESCE(i.refunded_quantity, 0))::float AS qty,
           i.modifiers,
           o.order_type
    FROM pos_order_items i
    JOIN pos_orders o ON o.id = i.order_id
    LEFT JOIN LATERAL (
      SELECT mm.id FROM "Menu" mm
      WHERE mm."storehubId" = i.product_id
         OR lower(btrim(mm.name)) = lower(btrim(i.product_name))
      ORDER BY (mm."storehubId" = i.product_id) DESC, mm."isActive" DESC, mm."updatedAt" DESC
      LIMIT 1
    ) m ON true
    WHERE o.outlet_id = ${opts.loyaltyOutletId ?? ""}
      AND o.status = 'completed' AND o.refund_of_order_id IS NULL
      AND o.created_at >= ${dayStartUtc} AND o.created_at < ${dayEndUtc}
    UNION ALL
    SELECT m.id,
           i.quantity::float,
           i.modifiers,
           o.order_type
    FROM order_items i
    JOIN orders o ON o.id = i.order_id
    LEFT JOIN LATERAL (
      SELECT mm.id FROM "Menu" mm
      WHERE mm."storehubId" = i.product_id
         OR lower(btrim(mm.name)) = lower(btrim(i.product_name))
      ORDER BY (mm."storehubId" = i.product_id) DESC, mm."isActive" DESC, mm."updatedAt" DESC
      LIMIT 1
    ) m ON true
    WHERE o.store_id = ${opts.pickupStoreId ?? ""}
      AND o.status = ANY(${PICKUP_STATUSES})
      AND o.created_at >= ${dayStartUtc} AND o.created_at < ${dayEndUtc}`;

  const soldMenuIds = new Set<string>();
  let itemsUnmapped = 0;
  for (const s of sales) {
    if (s.menu_id) soldMenuIds.add(s.menu_id);
    else itemsUnmapped += Number(s.qty);
  }

  // Full recipe rows for the sold menus — modifier and replacesProductId
  // included, because dropping them is exactly the bug that made the POS
  // trigger charge every coffee both milks and a double bean dose.
  const recipes = soldMenuIds.size
    ? await prisma.menuIngredient.findMany({
        where: { menuId: { in: [...soldMenuIds] } },
        select: {
          menuId: true,
          productId: true,
          quantityUsed: true,
          serviceMode: true,
          modifier: true,
          replacesProductId: true,
        },
      })
    : [];
  const recipeMap = new Map<string, ExpandRecipeLine[]>();
  for (const r of recipes) {
    const arr = recipeMap.get(r.menuId) ?? [];
    arr.push({
      productId: r.productId,
      quantityUsed: Number(r.quantityUsed),
      serviceMode: r.serviceMode,
      modifier: r.modifier,
      replacesProductId: r.replacesProductId,
    });
    recipeMap.set(r.menuId, arr);
  }
  const menusWithoutRecipe = [...soldMenuIds].filter((m) => !recipeMap.has(m)).length;

  const consumed = expandSoldLines(
    sales
      .filter((s) => s.menu_id && recipeMap.has(s.menu_id) && Number(s.qty) > 0)
      .map((s) => ({
        units: Number(s.qty),
        modifiers: s.modifiers,
        serviceMode: toServiceMode(s.order_type),
        recipe: recipeMap.get(s.menu_id!)!,
      })),
  );

  // Idempotency: did we already post this outlet+date? (Read here for the
  // report; the LIVE path re-checks inside its transaction — see below.)
  const marker = reasonMarker(date);
  const already = await prisma.stockAdjustment.findFirst({
    where: { outletId, reason: marker },
    select: { id: true },
  });
  let alreadyPosted = !!already;

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

  // Live posting (gated + idempotent + ATOMIC). One StockAdjustment per product
  // carrying the marker, plus a base-unit stock decrement, all in ONE
  // transaction with the marker re-check inside it: a crash half-way used to
  // leave some products posted — and since the marker was then present, the
  // rest of the day was never posted. Two overlapping runs also can't both
  // pass the check now (the second sees the first's rows or is rolled back).
  let posted = false;
  if (live && !alreadyPosted && lines.length) {
    posted = await prisma.$transaction(
      async (tx) => {
        const dup = await tx.stockAdjustment.findFirst({ where: { outletId, reason: marker }, select: { id: true } });
        if (dup) return false;
        await tx.stockAdjustment.createMany({
          data: lines.map((l) => ({
            outletId,
            productId: l.productId,
            adjustmentType: "USED_NOT_RECORDED" as const,
            quantity: l.quantity,
            reason: marker,
            adjustedById: opts.systemUserId!,
          })),
        });
        for (const l of lines) await decrementCanonicalBalance(tx, outletId, l.productId, l.quantity);
        return true;
      },
      { timeout: 60_000 },
    );
    if (!posted) alreadyPosted = true;
  }

  return {
    outletId,
    outletName,
    date,
    posted,
    alreadyPosted,
    menusSold: soldMenuIds.size,
    menusWithoutRecipe,
    itemsUnmapped,
    productsConsumed: lines.length,
    lines,
  };
}
