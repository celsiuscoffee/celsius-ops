import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, sku, groupId, baseUom, storageArea, shelfLifeDays, description, checkFrequency, itemType, packages } = body as {
      name?: string; sku?: string; groupId?: string; baseUom?: string;
      storageArea?: string; shelfLifeDays?: string; description?: string;
      checkFrequency?: string; itemType?: string;
      packages?: { id?: string; sku?: string; packageName: string; packageLabel: string; conversionFactor: number; isDefault?: boolean }[];
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = {};
    if (name) updateData.name = name;
    if (sku) updateData.sku = sku;
    if (groupId) updateData.groupId = groupId;
    if (baseUom) updateData.baseUom = baseUom;
    if (itemType) updateData.itemType = itemType;
    if (storageArea !== undefined) updateData.storageArea = storageArea || null;
    if (shelfLifeDays !== undefined) updateData.shelfLifeDays = shelfLifeDays ? parseInt(shelfLifeDays) : null;
    if (description !== undefined) updateData.description = description || null;
    if (checkFrequency) updateData.checkFrequency = checkFrequency;

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
    });

    // Handle packages: sync (upsert new/updated, delete removed)
    if (packages && Array.isArray(packages)) {
      const existingPackages = await prisma.productPackage.findMany({ where: { productId: id } });
      const incomingIds = packages.filter((p) => p.id).map((p) => p.id!);

      // Delete packages that are no longer in the list (only if not referenced)
      for (const existing of existingPackages) {
        if (!incomingIds.includes(existing.id)) {
          // Check if referenced by supplier products, order items, etc.
          const refCount = await prisma.supplierProduct.count({ where: { productPackageId: existing.id } });
          const orderRefCount = await prisma.orderItem.count({ where: { productPackageId: existing.id } });
          if (refCount === 0 && orderRefCount === 0) {
            await prisma.productPackage.delete({ where: { id: existing.id } });
          }
        }
      }

      // Upsert packages
      for (const pkg of packages) {
        if (pkg.id) {
          await prisma.productPackage.update({
            where: { id: pkg.id },
            data: {
              sku: pkg.sku || null,
              packageName: pkg.packageName,
              packageLabel: pkg.packageLabel,
              conversionFactor: pkg.conversionFactor,
              isDefault: pkg.isDefault ?? false,
            },
          });
        } else {
          await prisma.productPackage.create({
            data: {
              productId: id,
              sku: pkg.sku || null,
              packageName: pkg.packageName,
              packageLabel: pkg.packageLabel,
              conversionFactor: pkg.conversionFactor,
              isDefault: pkg.isDefault ?? false,
            },
          });
        }
      }
    }

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
