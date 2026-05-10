import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const [menus, supplierProducts] = await Promise.all([
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
  ]);

  // Build cost-per-base-unit map (cheapest non-zero supplier price / conversion factor)
  // Exclude ADHOC supplier (RM0 placeholder) to avoid zeroing out costs
  const costMap = new Map<string, number>();
  for (const sp of supplierProducts) {
    if (sp.supplier?.supplierCode === "ADHOC") continue;
    const price = Number(sp.price);
    if (price <= 0) continue;
    const conversion = sp.productPackage?.conversionFactor
      ? Number(sp.productPackage.conversionFactor)
      : 1;
    const costPerBase = price / conversion;
    const existing = costMap.get(sp.productId);
    if (!existing || costPerBase < existing) {
      costMap.set(sp.productId, costPerBase);
    }
  }

  const mapped = menus.map((m) => {
    const ingredients = m.ingredients.map((ing) => {
      const unitCost = costMap.get(ing.productId) ?? 0;
      const cost = Number(ing.quantityUsed) * unitCost;
      return {
        productId: ing.productId,
        product: ing.product.name,
        sku: ing.product.sku,
        qty: Number(ing.quantityUsed),
        uom: ing.uom,
        unitCost: Math.round(unitCost * 10000) / 10000,
        cost: Math.round(cost * 100) / 100,
      };
    });

    const cogs = ingredients.reduce((sum, ing) => sum + ing.cost, 0);
    const sellingPrice = Number(m.sellingPrice ?? 0);
    const cogsPercent = sellingPrice > 0 ? (cogs / sellingPrice) * 100 : 0;

    return {
      id: m.id,
      name: m.name,
      category: m.category ?? "",
      sellingPrice,
      cogs: Math.round(cogs * 100) / 100,
      cogsPercent: Math.round(cogsPercent * 10) / 10,
      ingredientCount: ingredients.length,
      ingredients,
    };
  });

  return NextResponse.json(mapped);
}
