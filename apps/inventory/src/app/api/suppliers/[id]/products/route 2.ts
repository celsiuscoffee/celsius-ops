import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/suppliers/[id]/products
 * Add a product to a supplier's price list.
 * Body: { productId, productPackageId?, price }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: supplierId } = await params;
  const body = await req.json();
  const { productId, productPackageId, price } = body;

  if (!productId || price === undefined) {
    return NextResponse.json({ error: "productId and price are required" }, { status: 400 });
  }

  const sp = await prisma.supplierProduct.upsert({
    where: {
      supplierId_productId_productPackageId: {
        supplierId,
        productId,
        productPackageId: productPackageId || null,
      },
    },
    create: {
      supplierId,
      productId,
      productPackageId: productPackageId || null,
      price,
    },
    update: {
      price,
    },
    include: {
      product: { select: { name: true, sku: true, baseUom: true } },
      productPackage: { select: { packageLabel: true, packageName: true } },
    },
  });

  return NextResponse.json({
    id: sp.id,
    productId: sp.productId,
    name: sp.product.name,
    sku: sp.product.sku,
    price: Number(sp.price),
    uom: sp.productPackage?.packageLabel ?? sp.productPackage?.packageName ?? sp.product.baseUom,
  }, { status: 201 });
}

/**
 * DELETE /api/suppliers/[id]/products
 * Remove a product from supplier's price list.
 * Body: { supplierProductId }
 */
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { supplierProductId } = body;

  if (!supplierProductId) {
    return NextResponse.json({ error: "supplierProductId is required" }, { status: 400 });
  }

  await prisma.supplierProduct.delete({ where: { id: supplierProductId } });
  return NextResponse.json({ ok: true });
}
