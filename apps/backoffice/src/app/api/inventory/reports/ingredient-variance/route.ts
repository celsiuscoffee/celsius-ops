import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { toBaseQty, buildVarianceRow, round2, type VarianceRow } from "@/lib/inventory/usage-variance";
import type { RecipeLine } from "@celsius/db";
import {
  fetchSoldLines,
  loadCatalogCostMap,
  loadPackagingRules,
  expandIngredientsForLine,
  expandPackagingForLine,
  expandPerOrderPackaging,
} from "@/lib/inventory/report-sales";

// GET /api/inventory/reports/ingredient-variance?outletId=&from=&to=
//
// Compares ACTUAL ingredient usage (reconstructed from physical stock movements
// between two stock counts) against EXPECTED usage (menu sales × recipe BOM).
// The gap is unexplained loss — over-portioning, theft, unrecorded spoilage —
// and tells us whether stock data is trustworthy enough to auto-reorder on.
//
// Count-bracketed: actual is only meaningful between two physical counts, so the
// effective period is [openingCount.date .. closingCount.date], chosen to sit
// inside the requested window. All movement quantities are normalised to base
// UOM at read time (movements are stored in mixed package/base units).

const WASTE_TYPES = ["WASTAGE", "BREAKAGE", "EXPIRED", "SPILLAGE", "THEFT", "USED_NOT_RECORDED"] as const;
const USABLE_COUNT_STATUS = ["SUBMITTED", "REVIEWED"] as const;
const ACTIVE_TRANSFER_STATUS = ["PENDING_APPROVAL", "PENDING", "APPROVED", "IN_TRANSIT", "RECEIVED", "COMPLETED"] as const;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outletId");
  const now = new Date();
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : new Date(now.getTime() - 30 * 86_400_000);
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

  const outlets = await prisma.outlet.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (!outletId) {
    // Variance is count-bracketed per outlet, so an outlet must be chosen.
    return NextResponse.json({ summary: null, outlets, items: [], warnings: emptyWarnings(), requireOutlet: true });
  }
  const outletName = outlets.find((o) => o.id === outletId)?.name ?? "Unknown";

  // ── 1. Bracket the period with two usable stock counts ──
  const counts = await prisma.stockCount.findMany({
    where: { outletId, status: { in: USABLE_COUNT_STATUS as unknown as ("SUBMITTED" | "REVIEWED")[] } },
    orderBy: { countDate: "asc" },
    select: { id: true, countDate: true, items: { select: { productId: true, productPackageId: true, countedQty: true } } },
  });

  // opening = latest count at/before `from`; if none, the earliest count we have.
  // closing = latest count at/before `to` strictly after opening.
  let opening = [...counts].filter((c) => c.countDate <= from).pop() ?? null;
  if (!opening && counts.length) opening = counts[0];
  const closing = opening
    ? [...counts].filter((c) => c.countDate <= to && c.countDate > opening!.countDate).pop() ?? null
    : null;

  if (!opening || !closing) {
    return NextResponse.json({
      summary: {
        outletId, outletName,
        requestedFrom: from.toISOString(), requestedTo: to.toISOString(),
        openingCountDate: opening?.countDate.toISOString() ?? null,
        closingCountDate: null,
        dataQuality: "insufficient" as const,
        reason: counts.length < 2
          ? "Need at least two stock counts to measure usage between them."
          : "No pair of stock counts brackets this period — widen the date range.",
        totalExpectedCost: null, totalVarianceCost: null, itemsAnalyzed: 0,
      },
      outlets, items: [], warnings: emptyWarnings(),
    });
  }

  const start = opening.countDate;
  const end = closing.countDate;
  const windowFilter = { gt: start, lte: end };

  // ── 2. Reference maps: package conversion + the catalog BOM page's cost basis ──
  const [packages, costMap, rules] = await Promise.all([
    prisma.productPackage.findMany({ select: { id: true, conversionFactor: true } }),
    loadCatalogCostMap(),
    loadPackagingRules(),
  ]);
  const convByPackage = new Map(packages.map((p) => [p.id, Number(p.conversionFactor)]));

  // ── 3. Stock-movement terms (all normalised to base UOM) ──
  const addBase = (m: Map<string, number>, productId: string, qty: number) =>
    m.set(productId, (m.get(productId) ?? 0) + qty);

  const openingQty = new Map<string, number>();
  for (const it of opening.items) addBase(openingQty, it.productId, toBaseQty(Number(it.countedQty ?? 0), it.productPackageId, convByPackage));
  const closingQty = new Map<string, number>();
  for (const it of closing.items) addBase(closingQty, it.productId, toBaseQty(Number(it.countedQty ?? 0), it.productPackageId, convByPackage));

  const [receivings, transfers, wastage, sales] = await Promise.all([
    prisma.receivingItem.findMany({
      where: { receiving: { outletId, receivedAt: windowFilter } },
      select: { productId: true, productPackageId: true, receivedQty: true },
    }),
    prisma.stockTransferItem.findMany({
      where: {
        transfer: {
          status: { in: ACTIVE_TRANSFER_STATUS as unknown as ("RECEIVED" | "COMPLETED")[] },
          OR: [
            { toOutletId: outletId, receivedAt: windowFilter },
            { fromOutletId: outletId, createdAt: windowFilter },
          ],
        },
      },
      select: {
        productId: true, productPackageId: true, quantity: true,
        transfer: { select: { fromOutletId: true, toOutletId: true } },
      },
    }),
    prisma.stockAdjustment.findMany({
      where: { outletId, adjustmentType: { in: WASTE_TYPES as unknown as ("WASTAGE")[] }, createdAt: windowFilter },
      select: { productId: true, quantity: true },
    }),
    // Live POS-native + customer-app sales (the old SalesTransaction feed died
    // 2026-04-11), per line so modifiers and channel can scope the recipe.
    fetchSoldLines({ outletIds: [outletId], from: start, to: end }),
  ]);

  const receiptsQty = new Map<string, number>();
  for (const ri of receivings) addBase(receiptsQty, ri.productId, toBaseQty(Number(ri.receivedQty), ri.productPackageId, convByPackage));

  const transfersInQty = new Map<string, number>();
  const transfersOutQty = new Map<string, number>();
  for (const ti of transfers) {
    const base = toBaseQty(Number(ti.quantity), ti.productPackageId, convByPackage);
    if (ti.transfer.toOutletId === outletId) addBase(transfersInQty, ti.productId, base);
    if (ti.transfer.fromOutletId === outletId) addBase(transfersOutQty, ti.productId, base);
  }

  const wastageQty = new Map<string, number>();
  for (const w of wastage) addBase(wastageQty, w.productId, Number(w.quantity)); // already base

  // ── 4. Expected usage = Σ over sold LINES of the recipe each line consumed ──
  // Same expansion the consumption engine posts: Iced/Hot doses, oat-milk
  // substitution and Extra Shot are read off each line's modifiers, and the
  // line's channel gates dine-in/takeaway recipe rows and packaging rules.
  const soldMenuIds = [...new Set(sales.map((s) => s.menuId).filter((m): m is string => !!m))];
  const [recipes, soldMenus] = await Promise.all([
    prisma.menuIngredient.findMany({
      where: soldMenuIds.length ? { menuId: { in: soldMenuIds } } : { menuId: "__none__" },
      select: {
        menuId: true, productId: true, quantityUsed: true, uom: true, serviceMode: true, modifier: true, replacesProductId: true,
        product: { select: { baseUom: true } },
      },
    }),
    soldMenuIds.length
      ? prisma.menu.findMany({ where: { id: { in: soldMenuIds } }, select: { id: true, name: true, category: true } })
      : Promise.resolve([]),
  ]);
  const recipeMap = new Map<string, RecipeLine[]>();
  const uomMismatches: { productId: string; menuUom: string; baseUom: string }[] = [];
  for (const r of recipes) {
    const arr = recipeMap.get(r.menuId) ?? [];
    arr.push({ productId: r.productId, quantityUsed: Number(r.quantityUsed), serviceMode: r.serviceMode, modifier: r.modifier, replacesProductId: r.replacesProductId });
    recipeMap.set(r.menuId, arr);
    if (r.product.baseUom && r.uom && r.uom.trim().toLowerCase() !== r.product.baseUom.trim().toLowerCase()) {
      uomMismatches.push({ productId: r.productId, menuUom: r.uom, baseUom: r.product.baseUom });
    }
  }
  const menuById = new Map(soldMenus.map((m) => [m.id, m]));
  const expectedQty = new Map<string, number>();
  for (const s of sales) {
    if (!s.menuId) continue;
    const menu = menuById.get(s.menuId);
    if (!menu) continue;
    const recipe = recipeMap.get(s.menuId);
    if (recipe) for (const [pid, q] of expandIngredientsForLine(s, recipe)) addBase(expectedQty, pid, q);
    for (const [pid, q] of expandPackagingForLine(s, menu, rules)) addBase(expectedQty, pid, q);
  }
  for (const [pid, q] of expandPerOrderPackaging(sales, menuById, rules)) addBase(expectedQty, pid, q);
  // Menus that sold but have no recipe → their ingredient usage is invisible.
  const menusWithoutBom = soldMenus.filter((m) => !recipeMap.has(m.id)).map((m) => m.name).sort();

  // ── 5. Build per-product variance rows over the product universe ──
  const universe = new Set<string>([
    ...openingQty.keys(), ...closingQty.keys(), ...receiptsQty.keys(),
    ...transfersInQty.keys(), ...transfersOutQty.keys(), ...wastageQty.keys(), ...expectedQty.keys(),
  ]);
  const products = await prisma.product.findMany({
    where: { id: { in: [...universe] } },
    select: { id: true, name: true, sku: true, baseUom: true, group: { select: { name: true } } },
  });
  const productMeta = new Map(products.map((p) => [p.id, p]));

  const items: (VarianceRow & { sku: string | null; category: string | null; movements: Record<string, number> })[] = [];
  const productsWithoutCost: string[] = [];
  for (const productId of universe) {
    const meta = productMeta.get(productId);
    if (!meta) continue;
    const o = openingQty.get(productId) ?? 0;
    const c = closingQty.get(productId) ?? 0;
    const rec = receiptsQty.get(productId) ?? 0;
    const tin = transfersInQty.get(productId) ?? 0;
    const tout = transfersOutQty.get(productId) ?? 0;
    const waste = wastageQty.get(productId) ?? 0;
    const actual = o + rec + tin - tout - waste - c;
    const expected = expectedQty.get(productId) ?? 0;
    // Skip products with no activity at all on either side.
    if (Math.abs(actual) < 0.0001 && expected < 0.0001) continue;
    const cost = costMap.get(productId) ?? 0;
    if (cost <= 0) productsWithoutCost.push(meta.name);
    const row = buildVarianceRow({
      productId, productName: meta.name, baseUom: meta.baseUom,
      actualQty: actual, expectedQty: expected, costPerBase: cost,
    });
    items.push({
      ...row, sku: meta.sku, category: meta.group?.name ?? null,
      movements: {
        openingCountQty: round2(o), receiptsQty: round2(rec), transfersInQty: round2(tin),
        transfersOutQty: round2(tout), recordedWastageQty: round2(waste), closingCountQty: round2(c),
      },
    });
  }
  // Biggest cost variance first — that's where the money leaks.
  items.sort((a, b) => Math.abs(b.varianceCost) - Math.abs(a.varianceCost));

  const totalExpectedCost = round2(items.reduce((s, i) => s + i.expectedCost, 0));
  const totalVarianceCost = round2(items.reduce((s, i) => s + i.varianceCost, 0));
  const dataQuality = menusWithoutBom.length === 0 && productsWithoutCost.length === 0 ? "complete" : "incomplete";

  return NextResponse.json({
    summary: {
      outletId, outletName,
      requestedFrom: from.toISOString(), requestedTo: to.toISOString(),
      openingCountDate: start.toISOString(), closingCountDate: end.toISOString(),
      totalExpectedCost, totalVarianceCost,
      totalVariancePercent: totalExpectedCost > 0 ? round2((totalVarianceCost / totalExpectedCost) * 100) : null,
      itemsAnalyzed: items.length,
      itemsOverUsed: items.filter((i) => i.varianceQty > 0).length,
      highVarianceCount: items.filter((i) => i.flags.includes("HIGH_VARIANCE")).length,
      dataQuality,
    },
    outlets,
    warnings: {
      menuItemsWithoutBom: menusWithoutBom,
      productsWithoutCost,
      uomMismatches,
      noSales: sales.length === 0,
    },
    items,
  });
}

function emptyWarnings() {
  return { menuItemsWithoutBom: [] as string[], productsWithoutCost: [] as string[], uomMismatches: [] as unknown[], noSales: false };
}
