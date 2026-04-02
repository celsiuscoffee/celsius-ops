import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const menus = await prisma.menu.findMany({
    include: {
      ingredients: {
        include: {
          product: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = menus.map((m) => {
    const ingredients = m.ingredients.map((ing) => ({
      product: ing.product.name,
      sku: ing.product.sku,
      qty: Number(ing.quantityUsed),
      uom: ing.uom,
      cost: 0, // would need supplier pricing to calculate
    }));

    return {
      id: m.id,
      name: m.name,
      category: m.category ?? "",
      sellingPrice: Number(m.sellingPrice ?? 0),
      cogs: 0,
      cogsPercent: 0,
      ingredientCount: ingredients.length,
      ingredients,
    };
  });

  return NextResponse.json(mapped);
}
