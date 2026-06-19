import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

type ServiceMode = "ALL" | "DINE_IN" | "TAKEAWAY";
const SERVICE_MODES: ServiceMode[] = ["ALL", "DINE_IN", "TAKEAWAY"];

/**
 * PUT /api/menus/[id]/ingredients
 *
 * Replace all BOM lines (ingredients + packaging) for a menu item.
 * Body: { ingredients: [{ productId, quantityUsed, uom, serviceMode?, modifier? }] }
 * serviceMode defaults to ALL (DINE_IN / TAKEAWAY scope a line to one channel);
 * modifier is an optional temperature condition ("Iced" / "Hot"; null = both) so
 * a recipe can differ by temperature without duplicating it.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
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

  // Replace all BOM lines in a transaction
  await prisma.$transaction([
    prisma.menuIngredient.deleteMany({ where: { menuId } }),
    ...ingredients.map(
      (ing: { productId: string; quantityUsed: number; uom: string; serviceMode?: string; modifier?: string }) =>
        prisma.menuIngredient.create({
          data: {
            menuId,
            productId: ing.productId,
            quantityUsed: ing.quantityUsed,
            uom: ing.uom,
            serviceMode: SERVICE_MODES.includes(ing.serviceMode as ServiceMode)
              ? (ing.serviceMode as ServiceMode)
              : "ALL",
            modifier: ing.modifier ? ing.modifier : null,
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
