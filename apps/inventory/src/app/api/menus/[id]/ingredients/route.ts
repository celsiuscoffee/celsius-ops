import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PUT /api/menus/[id]/ingredients
 *
 * Replace all ingredients for a menu item.
 * Body: { ingredients: [{ productId, quantityUsed, uom }] }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: menuId } = await params;
  const body = await req.json();
  const { ingredients } = body;

  if (!Array.isArray(ingredients)) {
    return NextResponse.json({ error: "ingredients must be an array" }, { status: 400 });
  }

  // Verify menu exists
  const menu = await prisma.menu.findUnique({ where: { id: menuId } });
  if (!menu) {
    return NextResponse.json({ error: "Menu not found" }, { status: 404 });
  }

  // Replace all ingredients in a transaction
  await prisma.$transaction([
    prisma.menuIngredient.deleteMany({ where: { menuId } }),
    ...ingredients.map(
      (ing: { productId: string; quantityUsed: number; uom: string }) =>
        prisma.menuIngredient.create({
          data: {
            menuId,
            productId: ing.productId,
            quantityUsed: ing.quantityUsed,
            uom: ing.uom,
          },
        }),
    ),
  ]);

  // Return updated menu with ingredients
  const updated = await prisma.menu.findUnique({
    where: { id: menuId },
    include: { ingredients: { include: { product: true } } },
  });

  return NextResponse.json(updated);
}
