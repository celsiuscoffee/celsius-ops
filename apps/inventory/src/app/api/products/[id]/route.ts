import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { name, sku, categoryId, baseUom, storageArea, shelfLifeDays, description } = body;

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(sku && { sku }),
      ...(categoryId && { categoryId }),
      ...(baseUom && { baseUom }),
      storageArea: storageArea ?? undefined,
      shelfLifeDays: shelfLifeDays !== undefined ? (shelfLifeDays ? parseInt(shelfLifeDays) : null) : undefined,
      description: description ?? undefined,
    },
  });

  return NextResponse.json(product);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.product.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
