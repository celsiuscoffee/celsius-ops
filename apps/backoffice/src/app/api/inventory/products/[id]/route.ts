import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, sku, categoryId, baseUom, storageArea, shelfLifeDays, description, checkFrequency } = body;

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
        ...(checkFrequency && { checkFrequency }),
      },
    });

    return NextResponse.json(product);
  } catch (err) {
    console.error("[products/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2003") {
      return NextResponse.json({ error: "Cannot delete product: it is referenced by existing orders, transfers, or stock records" }, { status: 409 });
    }
    console.error("[products/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
