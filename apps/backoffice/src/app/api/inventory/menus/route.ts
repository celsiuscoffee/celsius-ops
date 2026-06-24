import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

// Reference photos live in the customer-facing catalogue (the loyalty project's
// `products` table), keyed by product name. Pull them so each Recipe Card can
// show the plating reference next to its build. Best-effort: if the catalogue
// is unreachable, cards simply render without a photo.
type CatalogImage = { imageUrl: string; imageZoom: number };
async function loadCatalogImages(): Promise<Map<string, CatalogImage>> {
  const map = new Map<string, CatalogImage>();
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("products")
      .select("name, image_url, image_zoom")
      .eq("brand_id", "brand-celsius");
    for (const row of (data ?? []) as { name?: string; image_url?: string; image_zoom?: number }[]) {
      const key = (row.name ?? "").trim().toLowerCase();
      const url = (row.image_url ?? "").trim();
      if (!key || !url || map.has(key)) continue;
      map.set(key, { imageUrl: url, imageZoom: Number(row.image_zoom) || 100 });
    }
  } catch {
    // Photos are optional enrichment — never fail the menus payload over them.
  }
  return map;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const [menus, supplierProducts, packagingRules, catalogImages] = await Promise.all([
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
    loadCatalogImages(),
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
        modifier: ing.modifier, // null = both temperatures; "Iced" / "Hot"
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

    // A line applies to a given temperature × channel when its channel is ALL or
    // C, and its temperature is null (both) or V. Works for ingredient AND
    // packaging lines, so a recipe can differ by Hot/Iced (e.g. different syrup)
    // just like packaging does.
    const lineApplies = (l: Line, variant: "Hot" | "Iced", chan: "DINE_IN" | "TAKEAWAY") =>
      (l.serviceMode === "ALL" || l.serviceMode === chan) &&
      (l.modifier == null || l.modifier === variant);

    let packagingCount = 0;
    let ingredientTotal = 0; // recipe list total (informational; matrix is authoritative)
    for (const l of ingredients) {
      if (l.kind === "packaging") packagingCount += 1;
      else ingredientTotal += l.cost;
    }

    const sellingPrice = Number(m.sellingPrice ?? 0);
    const pct = (cogs: number) => (sellingPrice > 0 ? round1((cogs / sellingPrice) * 100) : 0);

    // 2×2 all-in COGS matrix: temperature (Hot/Iced) × channel (dine-in/takeaway).
    const cell = (variant: "Hot" | "Iced", chan: "DINE_IN" | "TAKEAWAY") => {
      let cogs = 0;
      let pkg = 0;
      for (const l of ingredients) {
        if (!lineApplies(l, variant, chan)) continue;
        cogs += l.cost;
        if (l.kind === "packaging") pkg += l.cost;
      }
      cogs = round2(cogs);
      return { pkg: round2(pkg), cogs, cogsPercent: pct(cogs) };
    };
    const matrix = {
      hot: { dineIn: cell("Hot", "DINE_IN"), takeaway: cell("Hot", "TAKEAWAY") },
      iced: { dineIn: cell("Iced", "DINE_IN"), takeaway: cell("Iced", "TAKEAWAY") },
    };
    // Does anything (ingredient or packaging) differ by temperature for this item?
    const hasIcedHotSplit = ingredients.some((l) => l.modifier != null);
    // Headline = worst case across the matrix (keeps High-COGS sort meaningful).
    const allIn = [matrix.hot.dineIn, matrix.hot.takeaway, matrix.iced.dineIn, matrix.iced.takeaway];
    const worst = allIn.reduce((a, b) => (b.cogs > a.cogs ? b : a));

    const photo = catalogImages.get(m.name.trim().toLowerCase());
    return {
      id: m.id,
      name: m.name,
      category: m.category ?? "",
      sellingPrice,
      imageUrl: photo?.imageUrl ?? null,
      imageZoom: photo?.imageZoom ?? 100,
      platingNote: m.platingNote ?? null,
      ingredientCost: round2(ingredientTotal),
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
