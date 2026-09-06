import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import type { RecipeLine } from "@celsius/db";
import {
  fetchSoldLines,
  loadCatalogCostMap,
  loadPackagingRules,
  expandIngredientsForLine,
  expandPackagingForLine,
  expandPerOrderPackaging,
  costOf,
} from "@/lib/inventory/report-sales";

// GET /api/inventory/reports/cogs?outletId=&from=&to=
//
// Expected COGS per menu item per outlet = what the recipes say each SOLD line
// consumed, costed at the catalog BOM page's cost basis. Sales come from the
// live POS-native + customer-app tables (see report-sales.ts) — the previous
// version read `SalesTransaction`, which stopped on 2026-04-11.
//
// Each line is expanded individually, not per menu, because the line's own
// modifiers (Iced/Hot dose, Oatmilk substitution, Extra Shot) and its
// fulfilment channel (dine-in vs takeaway cup) decide which recipe rows and
// packaging rules apply — the same expansion the consumption engine posts.

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  try {
    const { searchParams } = new URL(req.url);
    const outletId = searchParams.get("outletId");
    const now = new Date();
    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : new Date(now.getTime() - 30 * 86_400_000);
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;

    const [sales, outlets, costMap, rules] = await Promise.all([
      fetchSoldLines({ outletIds: outletId ? [outletId] : undefined, from, to }),
      prisma.outlet.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      loadCatalogCostMap(),
      loadPackagingRules(),
    ]);
    const outletNameMap = new Map(outlets.map((o) => [o.id, o.name]));

    const soldMenuIds = [...new Set(sales.map((s) => s.menuId).filter((m): m is string => !!m))];
    const [menus, recipeRows] = await Promise.all([
      soldMenuIds.length
        ? prisma.menu.findMany({ where: { id: { in: soldMenuIds } }, select: { id: true, name: true, category: true } })
        : Promise.resolve([]),
      soldMenuIds.length
        ? prisma.menuIngredient.findMany({
            where: { menuId: { in: soldMenuIds } },
            select: { menuId: true, productId: true, quantityUsed: true, serviceMode: true, modifier: true, replacesProductId: true },
          })
        : Promise.resolve([]),
    ]);
    const menuById = new Map(menus.map((m) => [m.id, m]));
    const recipeMap = new Map<string, RecipeLine[]>();
    for (const r of recipeRows) {
      const arr = recipeMap.get(r.menuId) ?? [];
      arr.push({ productId: r.productId, quantityUsed: Number(r.quantityUsed), serviceMode: r.serviceMode, modifier: r.modifier, replacesProductId: r.replacesProductId });
      recipeMap.set(r.menuId, arr);
    }

    // Aggregate per menu × outlet.
    type Agg = { menuId: string; outletId: string; qtySold: number; revenue: number; ingredientCogs: number; packagingCogs: number };
    const agg = new Map<string, Agg>();
    let unmappedQty = 0;
    let unmappedRevenue = 0;
    const menusWithoutRecipe = new Set<string>();
    for (const s of sales) {
      if (!s.menuId) { unmappedQty += s.qty; unmappedRevenue += s.revenue; continue; }
      const menu = menuById.get(s.menuId);
      if (!menu) continue;
      const recipe = recipeMap.get(s.menuId);
      if (!recipe) menusWithoutRecipe.add(menu.name);
      const key = `${s.menuId}_${s.outletId}`;
      const a = agg.get(key) ?? { menuId: s.menuId, outletId: s.outletId, qtySold: 0, revenue: 0, ingredientCogs: 0, packagingCogs: 0 };
      a.qtySold += s.qty;
      a.revenue += s.revenue;
      if (recipe) a.ingredientCogs += costOf(expandIngredientsForLine(s, recipe), costMap);
      a.packagingCogs += costOf(expandPackagingForLine(s, menu, rules), costMap);
      agg.set(key, a);
    }
    // Carrier bags etc. are per ORDER, so they sit outside the per-item rows.
    const perOrderPackagingCogs = round2(costOf(expandPerOrderPackaging(sales, menuById, rules), costMap));

    const items = [...agg.values()].map((a) => {
      const menu = menuById.get(a.menuId)!;
      const ingredientCogs = round2(a.ingredientCogs);
      const packagingCogs = round2(a.packagingCogs);
      const expectedCogs = round2(ingredientCogs + packagingCogs);
      const revenue = round2(a.revenue);
      const margin = round2(revenue - expectedCogs);
      return {
        menuName: menu.name,
        category: menu.category,
        qtySold: round2(a.qtySold),
        revenue,
        expectedCogs,
        ingredientCogs,
        packagingCogs,
        margin,
        marginPercent: revenue > 0 ? round2((margin / revenue) * 100) : 0,
        outletId: a.outletId,
        outletName: outletNameMap.get(a.outletId) ?? "Unknown",
      };
    });
    items.sort((a, b) => b.expectedCogs - a.expectedCogs);

    const totalRevenue = round2(items.reduce((s, i) => s + i.revenue, 0) + unmappedRevenue);
    const totalIngredientCogs = round2(items.reduce((s, i) => s + i.ingredientCogs, 0));
    const totalPackagingCogs = round2(items.reduce((s, i) => s + i.packagingCogs, 0) + perOrderPackagingCogs);
    const totalCogs = round2(totalIngredientCogs + totalPackagingCogs);
    const grossMargin = round2(totalRevenue - totalCogs);

    return NextResponse.json({
      summary: {
        totalRevenue,
        totalCogs,
        totalIngredientCogs,
        totalPackagingCogs,
        perOrderPackagingCogs,
        grossMargin,
        grossMarginPercent: totalRevenue > 0 ? round2((grossMargin / totalRevenue) * 100) : 0,
        menuItemCount: items.length,
        // Data-quality signals: revenue we could not cost (no menu match) and
        // menus sold without any recipe (their ingredient cost is invisible).
        unmappedQty: round2(unmappedQty),
        unmappedRevenue: round2(unmappedRevenue),
        menusWithoutRecipe: [...menusWithoutRecipe].sort(),
        salesSource: "pos_native+customer_app",
      },
      outlets,
      items,
    });
  } catch (error) {
    console.error("COGS report error:", error);
    return NextResponse.json({ error: "Failed to generate COGS report" }, { status: 500 });
  }
}
