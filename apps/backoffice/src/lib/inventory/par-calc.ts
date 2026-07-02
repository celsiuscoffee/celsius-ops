import { prisma } from "@/lib/prisma";

// ─── Par-level calculation (shared by the manual route + weekly cron) ────
//
// Formula (base UOM):
//   avgDailyUsage = Σ over menus (BOM quantityUsed × that menu's avg daily
//                   POS-native sales over the lookback)
//                   — falling back to purchase history (receivings) for
//                   products with no BOM linkage (packaging, direct-sale items)
//   reorderPoint  = usage × (leadTimeDays + safetyDays)        — NOT package-rounded
//   parLevel      = usage × (leadTime + safety + coverageDays) — rounded UP to a package
//   maxLevel      = max(parLevel × 1.5 rounded to a package, parLevel + one package)
//
// Why reorderPoint is left unrounded: rounding it up to a whole bulk package
// made reorder == par on 220/336 rows (both raws smaller than one carton), so
// those items read "below reorder" permanently and every PO composer / exec
// pass nudged another carton. The trigger should be the statistical point;
// only the AMOUNTS you buy need package rounding.
//
// Why maxLevel gets a one-package floor above par: with par == max (same
// rounding artifact), a suggested top-up of one package always breached the
// ceiling. Guaranteeing max ≥ par + 1 package keeps the overstock cap
// meaningful while never blocking the minimal possible order.
//
// Pars are ENGINE-MANAGED: every recalc overwrites all values for the outlet.
// Tune demand via recipes/lead times/safety days, not by hand-editing rows —
// manual edits do not survive the weekly recalc (documented behaviour).

export const PAR_DEFAULTS = {
  safetyDays: 1,
  coverageDays: 3,
  leadTimeDays: 1,
  lookbackDays: 30,
  maxLevelMultiplier: 1.5,
  // Purchase-fallback usage averages over a longer window — deliveries are
  // lumpy, so 30d would whipsaw items that arrive fortnightly.
  purchaseLookbackDays: 60,
} as const;

export interface ParCalcOptions {
  lookbackDays?: number;
  safetyDays?: number;
  coverageDays?: number;
}

export interface ParCalcDetail {
  productId: string;
  name: string;
  dailyUsage: number;
  usageSource: "bom" | "purchases";
  leadTime: number;
  reorderPoint: number;
  parLevel: number;
  maxLevel: number;
}

export interface ParCalcResult {
  ok: boolean;
  error?: string;
  salesTransactions: number;
  menuItemsWithSales: number;
  productsUpdated: number;
  fallbackProducts: number;
  lookbackDays: number;
  settings: { safetyDays: number; coverageDays: number };
  details: ParCalcDetail[];
}

export async function recalcOutletParLevels(outletId: string, opts: ParCalcOptions = {}): Promise<ParCalcResult> {
  const lookbackDays = opts.lookbackDays ?? PAR_DEFAULTS.lookbackDays;
  const safetyDays = opts.safetyDays ?? PAR_DEFAULTS.safetyDays;
  const coverageDays = opts.coverageDays ?? PAR_DEFAULTS.coverageDays;

  const empty: Omit<ParCalcResult, "ok" | "error"> = {
    salesTransactions: 0,
    menuItemsWithSales: 0,
    productsUpdated: 0,
    fallbackProducts: 0,
    lookbackDays,
    settings: { safetyDays, coverageDays },
    details: [],
  };

  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const purchaseSince = new Date();
  purchaseSince.setDate(purchaseSince.getDate() - PAR_DEFAULTS.purchaseLookbackDays);

  // POS-native sales source (StoreHub retired). pos_orders.outlet_id is the
  // native/loyalty id (e.g. "outlet-con"); the inventory `outletId` here is the
  // Outlet uuid, so resolve across. The native POS reuses StoreHub product ids,
  // so pos_order_items.product_id maps to Menu.storehubId.
  const outletRow = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { loyaltyOutletId: true },
  });
  const loyaltyOutletId = outletRow?.loyaltyOutletId ?? null;

  const [salesByMenuRaw, bom, supplierProducts, productPackages, receivedLines] = await Promise.all([
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
    prisma.menuIngredient.findMany({ include: { menu: true, product: true } }),
    prisma.supplierProduct.findMany({
      where: { isActive: true },
      select: {
        productId: true,
        price: true,
        supplier: { select: { leadTimeDays: true } },
        productPackage: { select: { conversionFactor: true } },
      },
    }),
    // Packages for rounding to whole purchasable packages — prefer bulk
    // (containsPackageId set), then default, then largest.
    prisma.productPackage.findMany({
      select: { productId: true, conversionFactor: true, isDefault: true, containsPackageId: true },
      orderBy: { conversionFactor: "desc" },
    }),
    // Purchase history for the fallback usage estimate. receivedQty is stored
    // in the line's PACKAGE units — convert via its own package factor.
    prisma.receivingItem.findMany({
      where: { receiving: { outletId, receivedAt: { gte: purchaseSince } } },
      select: {
        productId: true,
        receivedQty: true,
        productPackage: { select: { conversionFactor: true } },
        product: { select: { name: true, sku: true, baseUom: true } },
      },
    }),
  ]);

  const salesByMenu = salesByMenuRaw.map((r) => ({ menuId: r.menuId, qty: Number(r.quantity) }));
  const salesCount = salesByMenu.reduce((s, r) => s + r.qty, 0);
  if (salesCount === 0) {
    return { ...empty, ok: false, error: `No POS sales for this outlet in the last ${lookbackDays} days.` };
  }

  const avgDailySalesByMenu: Record<string, number> = {};
  for (const row of salesByMenu) {
    if (row.menuId) avgDailySalesByMenu[row.menuId] = row.qty / lookbackDays;
  }

  // Shortest lead time per product across its suppliers.
  const leadTimeMap: Record<string, number> = {};
  for (const sp of supplierProducts) {
    const lt = sp.supplier.leadTimeDays || PAR_DEFAULTS.leadTimeDays;
    if (!leadTimeMap[sp.productId] || lt < leadTimeMap[sp.productId]) leadTimeMap[sp.productId] = lt;
  }
  const orderable = new Set(supplierProducts.map((sp) => sp.productId));

  // ── Daily usage: BOM × sales ──
  const usageByProduct: Record<
    string,
    { name: string; dailyUsage: number; source: "bom" | "purchases" }
  > = {};
  for (const ingredient of bom) {
    const avgDailySales = avgDailySalesByMenu[ingredient.menuId];
    if (!avgDailySales) continue;
    const add = Number(ingredient.quantityUsed) * avgDailySales;
    const cur = usageByProduct[ingredient.productId];
    if (cur) cur.dailyUsage += add;
    else usageByProduct[ingredient.productId] = { name: ingredient.product.name, dailyUsage: add, source: "bom" };
  }

  // ── Fallback usage: purchase history, for orderable products the BOM
  // doesn't reach (packaging, direct-sale cakes, cleaning). Over a long
  // window, what an outlet buys of a consumable approximates what it uses.
  let fallbackProducts = 0;
  const receivedBase: Record<string, { name: string; base: number }> = {};
  for (const line of receivedLines) {
    const convRaw = line.productPackage ? Number(line.productPackage.conversionFactor) : 1;
    const conv = convRaw > 0 ? convRaw : 1;
    const cur = receivedBase[line.productId];
    const add = Number(line.receivedQty) * conv;
    if (cur) cur.base += add;
    else receivedBase[line.productId] = { name: line.product?.name ?? "?", base: add };
  }
  for (const [productId, r] of Object.entries(receivedBase)) {
    if (usageByProduct[productId]) continue; // BOM wins — it tracks demand, not delivery cadence
    if (!orderable.has(productId)) continue;
    const daily = r.base / PAR_DEFAULTS.purchaseLookbackDays;
    if (daily <= 0) continue;
    usageByProduct[productId] = { name: r.name, dailyUsage: daily, source: "purchases" };
    fallbackProducts++;
  }

  // Package factor per product for rounding (bulk preferred).
  const packageMap: Record<string, number> = {};
  for (const pkg of productPackages) {
    const cf = Number(pkg.conversionFactor);
    if (!packageMap[pkg.productId]) packageMap[pkg.productId] = cf;
    if (pkg.containsPackageId && cf > 0) packageMap[pkg.productId] = cf;
  }
  const packageSize = (productId: string) => {
    const cf = packageMap[productId];
    return cf && cf > 0 ? cf : 1;
  };
  const roundToPackage = (baseQty: number, productId: string) => {
    const cf = packageSize(productId);
    return Math.ceil(baseQty / cf) * cf;
  };

  const details: ParCalcDetail[] = [];
  const upserts = Object.entries(usageByProduct)
    .map(([productId, data]) => {
      if (data.dailyUsage <= 0) return null;
      const leadTime = leadTimeMap[productId] || PAR_DEFAULTS.leadTimeDays;

      const rawReorder = data.dailyUsage * (leadTime + safetyDays);
      const rawPar = data.dailyUsage * (leadTime + safetyDays + coverageDays);
      const rawMax = rawPar * PAR_DEFAULTS.maxLevelMultiplier;

      // Trigger stays statistical; amounts get package-rounded; the ceiling
      // always leaves room for at least one more package above par.
      const reorderPoint = Math.ceil(rawReorder);
      const parLevel = roundToPackage(rawPar, productId);
      const maxLevel = Math.max(roundToPackage(rawMax, productId), parLevel + packageSize(productId));

      details.push({
        productId,
        name: data.name,
        dailyUsage: Math.round(data.dailyUsage * 100) / 100,
        usageSource: data.source,
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

  return {
    ok: true,
    salesTransactions: salesCount,
    menuItemsWithSales: Object.keys(avgDailySalesByMenu).length,
    productsUpdated: upserts.length,
    fallbackProducts,
    lookbackDays,
    settings: { safetyDays, coverageDays },
    details: details.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
