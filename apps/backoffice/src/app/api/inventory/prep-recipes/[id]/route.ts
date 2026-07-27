import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { normaliseItems } from "../route";

// PATCH /api/inventory/prep-recipes/[id]
// Header fields are patched individually; `items`, when present, REPLACES the
// whole input list in one transaction (the editor always submits the full set,
// and a partial replace would silently leave orphan lines costing the batch).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const existing = await prisma.productRecipe.findUnique({ where: { id }, select: { outputProductId: true } });
  if (!existing) return NextResponse.json({ error: "Recipe not found" }, { status: 404 });

  const data: {
    yieldQuantity?: number;
    yieldUom?: string;
    prepNote?: string | null;
    isActive?: boolean;
  } = {};

  if (body.yieldQuantity !== undefined) {
    const y = Number(body.yieldQuantity);
    // Guard the divide-by-zero in cost-per-unit.
    if (!Number.isFinite(y) || y <= 0) {
      return NextResponse.json({ error: "Yield quantity must be greater than zero" }, { status: 400 });
    }
    data.yieldQuantity = y;
  }
  if (typeof body.yieldUom === "string" && body.yieldUom) data.yieldUom = body.yieldUom;
  if (body.prepNote !== undefined) data.prepNote = body.prepNote || null;
  if (body.isActive !== undefined) data.isActive = !!body.isActive;

  if (body.items === undefined) {
    const updated = await prisma.productRecipe.update({ where: { id }, data, select: { id: true } });
    return NextResponse.json(updated);
  }

  const parsed = normaliseItems(body.items);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.items.some((i) => i.productId === existing.outputProductId)) {
    return NextResponse.json({ error: "A recipe cannot consume its own output product" }, { status: 400 });
  }

  // Replace-style write: delete + insert must be ONE transaction, or a failure
  // between them leaves the recipe with no inputs and a silently zero cost.
  await prisma.$transaction([
    prisma.productRecipe.update({ where: { id }, data }),
    prisma.productRecipeItem.deleteMany({ where: { recipeId: id } }),
    prisma.productRecipeItem.createMany({
      data: parsed.items.map((i) => ({ ...i, recipeId: id })),
    }),
  ]);

  return NextResponse.json({ id });
}

// DELETE — removes the recipe; its item lines cascade (FK ON DELETE CASCADE).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  await prisma.productRecipe.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
