import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { recordPriceChange } from "@/lib/inventory/price-history";

/**
 * POST /api/suppliers/[id]/products
 * Add a product to a supplier's price list.
 * Body: { productId, productPackageId?, price }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { id: supplierId } = await params;
  const body = await req.json();
  const { productId, productPackageId, price } = body;

  if (!productId || price === undefined) {
    return NextResponse.json({ error: "productId and price are required" }, { status: 400 });
  }

  // Find existing or create — can't use upsert with nullable composite key
  const existing = await prisma.supplierProduct.findFirst({
    where: {
      supplierId,
      productId,
      productPackageId: productPackageId || null,
    },
  });

  if (existing) {
    await recordPriceChange({
      supplierId,
      productId,
      productPackageId: productPackageId || null,
      oldPrice: Number(existing.price),
      newPrice: Number(price),
    });
  }

  const sp = existing
    ? await prisma.supplierProduct.update({
        where: { id: existing.id },
        data: { price },
        include: {
          product: { select: { name: true, sku: true, baseUom: true } },
          productPackage: { select: { packageLabel: true, packageName: true } },
        },
      })
    : await prisma.supplierProduct.create({
        data: {
          supplierId,
          productId,
          productPackageId: productPackageId || null,
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
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { supplierProductId } = body;

  if (!supplierProductId) {
    return NextResponse.json({ error: "supplierProductId is required" }, { status: 400 });
  }

  await prisma.supplierProduct.delete({ where: { id: supplierProductId } });
  return NextResponse.json({ ok: true });
}
