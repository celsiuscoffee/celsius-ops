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
      select: { productId: true, quantity: true, scope: true, category: true, menuIds: true, channel: true },
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

  // Pre-resolve per-item packaging rules to {cost, scope, channel} so each
  // menu just checks applicability.
  const rules = packagingRules.map((r) => ({
    cost: Number(r.quantity) * (costMap.get(r.productId) ?? 0),
    scope: r.scope,
    category: r.category,
    menuIdSet: new Set(r.menuIds),
    channel: r.channel as "ALL" | "DINE_IN" | "TAKEAWAY",
  }));

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const mapped = menus.map((m) => {
    const ingredients = m.ingredients.map((ing) => {
      const unitCost = costMap.get(ing.productId) ?? 0;
      const cost = Number(ing.quantityUsed) * unitCost;
      const kind = ing.product.itemType === "PACKAGING" ? "packaging" : "ingredient";
      return {
        productId: ing.productId,
        product: ing.product.name,
        sku: ing.product.sku,
        qty: Number(ing.quantityUsed),
        uom: ing.uom,
        serviceMode: ing.serviceMode, // ALL | DINE_IN | TAKEAWAY
        kind, // "ingredient" | "packaging"
        unitCost: Math.round(unitCost * 10000) / 10000,
        cost: round2(cost),
      };
    });

    // Bucket each BOM line by kind × channel. ALL lines are billed on every
    // sale; DINE_IN / TAKEAWAY lines only on that channel. Channel COGS =
    // (ALL + that-channel ingredient) + (ALL + that-channel packaging).
    let ingredientCost = 0; // channel-agnostic recipe cost (the food/drink)
    let packagingDineIn = 0;
    let packagingTakeaway = 0;
    let ingredientDineExtra = 0;
    let ingredientTakeExtra = 0;
    let packagingCount = 0;
    for (const ing of ingredients) {
      if (ing.kind === "packaging") {
        packagingCount += 1;
        if (ing.serviceMode !== "TAKEAWAY") packagingDineIn += ing.cost;
        if (ing.serviceMode !== "DINE_IN") packagingTakeaway += ing.cost;
      } else {
        if (ing.serviceMode === "DINE_IN") ingredientDineExtra += ing.cost;
        else if (ing.serviceMode === "TAKEAWAY") ingredientTakeExtra += ing.cost;
        else ingredientCost += ing.cost;
      }
    }

    // Fold in matching per-item packaging rules (cup/lid/straw on a category or
    // all drinks). ALL bills both channels; DINE_IN / TAKEAWAY only that one.
    let ruleMatches = 0;
    for (const r of rules) {
      const applies =
        r.scope === "ALL" ? true :
        r.scope === "CATEGORY" ? (m.category ?? "") === (r.category ?? "") :
        r.menuIdSet.has(m.id);
      if (!applies) continue;
      ruleMatches += 1;
      if (r.channel !== "TAKEAWAY") packagingDineIn += r.cost;
      if (r.channel !== "DINE_IN") packagingTakeaway += r.cost;
    }

    const dineInCogs = ingredientCost + ingredientDineExtra + packagingDineIn;
    const takeawayCogs = ingredientCost + ingredientTakeExtra + packagingTakeaway;
    const sellingPrice = Number(m.sellingPrice ?? 0);
    const pct = (cogs: number) => (sellingPrice > 0 ? (cogs / sellingPrice) * 100 : 0);

    return {
      id: m.id,
      name: m.name,
      category: m.category ?? "",
      sellingPrice,
      // Recipe/ingredient cost only (what the old `cogs` meant).
      ingredientCost: round2(ingredientCost + ingredientDineExtra + ingredientTakeExtra),
      packagingDineIn: round2(packagingDineIn),
      packagingTakeaway: round2(packagingTakeaway),
      dineInCogs: round2(dineInCogs),
      takeawayCogs: round2(takeawayCogs),
      dineInCogsPercent: round1(pct(dineInCogs)),
      takeawayCogsPercent: round1(pct(takeawayCogs)),
      // Headline COGS = all-in worst case (takeaway). Keeps the "High COGS"
      // filter and sort meaningful now that packaging is included.
      cogs: round2(takeawayCogs),
      cogsPercent: round1(pct(takeawayCogs)),
      ingredientCount: ingredients.length - packagingCount,
      packagingCount: packagingCount + ruleMatches,
      ingredients,
    };
  });

  return NextResponse.json(mapped);
}
