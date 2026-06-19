import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const [menus, supplierProducts, packagingRules] = await Promise.all([
    prisma.menu.findMany({
      include: {
        ingredients: {
          include: { product: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.supplierProduct.findMany({
      where: { isActive: true },
      select: {
        productId: true,
        price: true,
        productPackage: { select: { conversionFactor: true } },
        supplier: { select: { supplierCode: true } },
      },
    }),
    // Per-item packaging rules that fold into a menu item's dine-in/takeaway
    // cost. Per-order and Grab/Delivery rules are order-level, not per item.
    prisma.packagingRule.findMany({
      where: { isActive: true, perOrder: false, channel: { in: ["ALL", "DINE_IN", "TAKEAWAY"] } },
      select: {
        productId: true, quantity: true, scope: true, category: true, menuIds: true, channel: true, modifier: true,
        product: { select: { name: true, sku: true, baseUom: true } },
      },
    }),
  ]);

  // Build cost-per-base-unit map (cheapest non-zero supplier price / conversion factor)
  // Exclude ADHOC supplier (RM0 placeholder) to avoid zeroing out costs
  const costMap = new Map<string, number>();
  for (const sp of supplierProducts) {
    if (sp.supplier?.supplierCode === "ADHOC") continue;
    const price = Number(sp.price);
    if (price <= 0) continue;
    // Skip rows with no package mapping — see comment in stock-valuation
    // route. Without package context, price-per-base interpretation is wrong.
    const conversion = sp.productPackage?.conversionFactor
      ? Number(sp.productPackage.conversionFactor)
      : 0;
    if (conversion <= 0) continue;
    const costPerBase = price / conversion;
    const existing = costMap.get(sp.productId);
    if (!existing || costPerBase < existing) {
      costMap.set(sp.productId, costPerBase);
    }
  }

  // Pre-resolve per-item packaging rules so each menu just checks applicability.
  const rules = packagingRules.map((r) => {
    const unitCost = costMap.get(r.productId) ?? 0;
    return {
      productId: r.productId,
      name: r.product.name,
      sku: r.product.sku,
      uom: r.product.baseUom,
      qty: Number(r.quantity),
      unitCost,
      cost: Number(r.quantity) * unitCost,
      scope: r.scope,
      category: r.category,
      menuIdSet: new Set(r.menuIds),
      channel: r.channel as "ALL" | "DINE_IN" | "TAKEAWAY",
      modifier: r.modifier, // null = any temperature; "Iced" / "Hot"
    };
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  type Line = {
    productId: string;
    product: string;
    sku: string;
    qty: number;
    uom: string;
    serviceMode: "ALL" | "DINE_IN" | "TAKEAWAY";
    modifier: string | null; // null = any temperature; "Iced" / "Hot"
    kind: "ingredient" | "packaging";
    source: "bom" | "rule"; // "rule" lines are managed on the Packaging page
    unitCost: number;
    cost: number;
  };

  const mapped = menus.map((m) => {
    const ingredients: Line[] = m.ingredients.map((ing): Line => {
      const unitCost = costMap.get(ing.productId) ?? 0;
      const cost = Number(ing.quantityUsed) * unitCost;
      return {
        productId: ing.productId,
        product: ing.product.name,
        sku: ing.product.sku,
        qty: Number(ing.quantityUsed),
        uom: ing.uom,
        serviceMode: ing.serviceMode, // ALL | DINE_IN | TAKEAWAY
        modifier: null, // BOM lines apply regardless of temperature
        kind: ing.product.itemType === "PACKAGING" ? "packaging" : "ingredient",
        source: "bom",
        unitCost: Math.round(unitCost * 10000) / 10000,
        cost: round2(cost),
      };
    });

    // Append matching packaging-rule lines (cup/lid/straw on a category or all
    // drinks). Read-only here — managed on the Packaging page — but they cost in
    // exactly like a BOM packaging line.
    for (const r of rules) {
      const applies =
        r.scope === "ALL" ? true :
        r.scope === "CATEGORY" ? (m.category ?? "") === (r.category ?? "") :
        r.menuIdSet.has(m.id);
      if (!applies) continue;
      ingredients.push({
        productId: r.productId,
        product: r.name,
        sku: r.sku,
        qty: r.qty,
        uom: r.uom,
        serviceMode: r.channel,
        modifier: r.modifier,
        kind: "packaging",
        source: "rule",
        unitCost: Math.round(r.unitCost * 10000) / 10000,
        cost: round2(r.cost),
      });
    }

    // Recipe (ingredient) cost — temperature-agnostic. Channel-tagged ingredient
    // BOM lines are rare but supported.
    let ingredientCost = 0;
    let ingredientDineExtra = 0;
    let ingredientTakeExtra = 0;
    let packagingCount = 0;
    for (const ing of ingredients) {
      if (ing.kind === "packaging") {
        packagingCount += 1;
      } else if (ing.serviceMode === "DINE_IN") ingredientDineExtra += ing.cost;
      else if (ing.serviceMode === "TAKEAWAY") ingredientTakeExtra += ing.cost;
      else ingredientCost += ing.cost;
    }
    const recipeCost = round2(ingredientCost + ingredientDineExtra + ingredientTakeExtra);

    // Packaging by (temperature × channel). A line applies to variant V and
    // channel C when its channel is ALL or C, and its modifier is null (any) or V.
    const pkgFor = (variant: "Hot" | "Iced", chan: "DINE_IN" | "TAKEAWAY") =>
      round2(
        ingredients
          .filter((l) => l.kind === "packaging"
            && (l.serviceMode === "ALL" || l.serviceMode === chan)
            && (l.modifier == null || l.modifier === variant))
          .reduce((s, l) => s + l.cost, 0),
      );

    const sellingPrice = Number(m.sellingPrice ?? 0);
    const pct = (cogs: number) => (sellingPrice > 0 ? round1((cogs / sellingPrice) * 100) : 0);
    const ingBase = (chan: "DINE_IN" | "TAKEAWAY") =>
      ingredientCost + (chan === "DINE_IN" ? ingredientDineExtra : ingredientTakeExtra);

    // 2×2 all-in COGS matrix: temperature (Hot/Iced) × channel (dine-in/takeaway).
    const cell = (variant: "Hot" | "Iced", chan: "DINE_IN" | "TAKEAWAY") => {
      const pkg = pkgFor(variant, chan);
      const cogs = round2(ingBase(chan) + pkg);
      return { pkg, cogs, cogsPercent: pct(cogs) };
    };
    const matrix = {
      hot: { dineIn: cell("Hot", "DINE_IN"), takeaway: cell("Hot", "TAKEAWAY") },
      iced: { dineIn: cell("Iced", "DINE_IN"), takeaway: cell("Iced", "TAKEAWAY") },
    };
    // Does packaging actually differ by temperature for this item?
    const hasIcedHotSplit = ingredients.some((l) => l.kind === "packaging" && l.modifier != null);
    // Headline = worst case across the matrix (keeps High-COGS sort meaningful).
    const allIn = [matrix.hot.dineIn, matrix.hot.takeaway, matrix.iced.dineIn, matrix.iced.takeaway];
    const worst = allIn.reduce((a, b) => (b.cogs > a.cogs ? b : a));

    return {
      id: m.id,
      name: m.name,
      category: m.category ?? "",
      sellingPrice,
      ingredientCost: recipeCost,
      matrix,
      hasIcedHotSplit,
      cogs: worst.cogs,
      cogsPercent: worst.cogsPercent,
      ingredientCount: ingredients.length - packagingCount,
      packagingCount,
      ingredients,
    };
  });

  return NextResponse.json(mapped);
}
