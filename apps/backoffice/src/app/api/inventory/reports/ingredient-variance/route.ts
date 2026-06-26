import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { toBaseQty, buildVarianceRow, round2, type VarianceRow } from "@/lib/inventory/usage-variance";

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
const DEFAULT_TAKEAWAY_RATIO = 0.5;

const channelWeight = (mode: "ALL" | "DINE_IN" | "TAKEAWAY") =>
  mode === "TAKEAWAY" ? DEFAULT_TAKEAWAY_RATIO : mode === "DINE_IN" ? 1 - DEFAULT_TAKEAWAY_RATIO : 1;

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

  // ── 2. Reference maps: package conversion + cheapest cost per base unit ──
  const [packages, supplierProducts] = await Promise.all([
    prisma.productPackage.findMany({ select: { id: true, conversionFactor: true } }),
    prisma.supplierProduct.findMany({
      where: { isActive: true, price: { gt: 0 } },
      select: { productId: true, price: true, productPackage: { select: { conversionFactor: true } } },
    }),
  ]);
  const convByPackage = new Map(packages.map((p) => [p.id, Number(p.conversionFactor)]));
  const costMap = new Map<string, number>();
  for (const sp of supplierProducts) {
    const conv = sp.productPackage ? Number(sp.productPackage.conversionFactor) : 0;
    if (conv <= 0) continue;
    const costPerBase = Number(sp.price) / conv;
    const existing = costMap.get(sp.productId);
    if (!existing || costPerBase < existing) costMap.set(sp.productId, costPerBase);
  }

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
    prisma.salesTransaction.findMany({
      where: { outletId, menuId: { not: null }, transactedAt: windowFilter },
      select: { menuId: true, quantity: true },
    }),
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

  // ── 4. Expected usage = Σ(sales × BOM qty), reusing the COGS recipe approach ──
  const salesByMenu = new Map<string, number>();
  for (const s of sales) if (s.menuId) salesByMenu.set(s.menuId, (salesByMenu.get(s.menuId) ?? 0) + s.quantity);

  const recipes = await prisma.menuIngredient.findMany({
    where: salesByMenu.size ? { menuId: { in: [...salesByMenu.keys()] } } : { menuId: "__none__" },
    select: {
      menuId: true, productId: true, quantityUsed: true, uom: true, serviceMode: true,
      menu: { select: { name: true } },
      product: { select: { baseUom: true } },
    },
  });
  const expectedQty = new Map<string, number>();
  const menusWithBom = new Set<string>();
  const uomMismatches: { productId: string; menuUom: string; baseUom: string }[] = [];
  for (const r of recipes) {
    menusWithBom.add(r.menuId);
    const sold = salesByMenu.get(r.menuId) ?? 0;
    if (sold === 0) continue;
    addBase(expectedQty, r.productId, sold * Number(r.quantityUsed) * channelWeight(r.serviceMode));
    if (r.product.baseUom && r.uom && r.uom.trim().toLowerCase() !== r.product.baseUom.trim().toLowerCase()) {
      uomMismatches.push({ productId: r.productId, menuUom: r.uom, baseUom: r.product.baseUom });
    }
  }
  // Menus that sold but have no recipe → their ingredient usage is invisible.
  const menusWithoutBom: string[] = [];
  if (salesByMenu.size) {
    const soldMenus = await prisma.menu.findMany({
      where: { id: { in: [...salesByMenu.keys()] } },
      select: { id: true, name: true },
    });
    for (const m of soldMenus) if (!menusWithBom.has(m.id)) menusWithoutBom.push(m.name);
  }

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
