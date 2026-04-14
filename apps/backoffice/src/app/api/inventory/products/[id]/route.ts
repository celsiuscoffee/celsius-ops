import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;
    const body = await req.json();
    const { name, sku, groupId, baseUom, storageArea, shelfLifeDays, description, checkFrequency, itemType, packages, suppliers } = body as {
      name?: string; sku?: string; groupId?: string; baseUom?: string;
      storageArea?: string; shelfLifeDays?: string; description?: string;
      checkFrequency?: string; itemType?: string;
      packages?: { id?: string; sku?: string; packageName: string; packageLabel: string; conversionFactor: number; isDefault?: boolean; containsPackageId?: string | null; containsPackageIndex?: number }[];
      suppliers?: { supplierId?: string; supplierName?: string; phone?: string; price: number; productPackageId?: string; packageIndex?: number }[];
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
      const createdPkgIds: string[] = [];
      for (const pkg of packages) {
        const pkgData = {
          sku: pkg.sku || null,
          packageName: pkg.packageName,
          packageLabel: pkg.packageLabel,
          conversionFactor: pkg.conversionFactor,
          isDefault: pkg.isDefault ?? false,
          containsPackageId: pkg.containsPackageId || null,
        };
        if (pkg.id) {
          await prisma.productPackage.update({
            where: { id: pkg.id },
            data: pkgData,
          });
          createdPkgIds.push(pkg.id);
        } else {
          // Check if a package with this name already exists (e.g. couldn't be deleted due to references)
          const existingByName = existingPackages.find((ep) => ep.packageName === pkg.packageName);
          if (existingByName) {
            await prisma.productPackage.update({
              where: { id: existingByName.id },
              data: pkgData,
            });
            createdPkgIds.push(existingByName.id);
          } else {
            const created = await prisma.productPackage.create({
              data: { productId: id, ...pkgData },
            });
            createdPkgIds.push(created.id);
          }
        }
      }
      // Resolve containsPackageIndex for new packages referencing other new packages
      for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        if (pkg.containsPackageIndex !== undefined && createdPkgIds[pkg.containsPackageIndex]) {
          await prisma.productPackage.update({
            where: { id: createdPkgIds[i] },
            data: { containsPackageId: createdPkgIds[pkg.containsPackageIndex] },
          });
        }
      }
    }

    // Handle suppliers: sync supplier-product links
    if (suppliers && Array.isArray(suppliers)) {
      // Get existing supplier links (exclude ADHOC — managed separately)
      const adhocSupplier = await prisma.supplier.findFirst({ where: { supplierCode: "ADHOC" } });
      const existing = await prisma.supplierProduct.findMany({
        where: { productId: id, ...(adhocSupplier ? { supplierId: { not: adhocSupplier.id } } : {}) },
      });

      // Delete removed supplier links
      const incomingSupplierIds = new Set(
        suppliers.filter((s) => s.supplierId).map((s) => `${s.supplierId}-${s.productPackageId || ""}`)
      );
      for (const ex of existing) {
        if (!incomingSupplierIds.has(`${ex.supplierId}-${ex.productPackageId || ""}`)) {
          await prisma.supplierProduct.delete({ where: { id: ex.id } });
        }
      }

      // Resolve package IDs created in packages step above
      const createdPkgIds = packages ? await prisma.productPackage.findMany({
        where: { productId: id },
        select: { id: true },
      }).then((pkgs) => pkgs.map((p) => p.id)) : [];

      // Upsert supplier links
      for (const entry of suppliers) {
        let supplierId = entry.supplierId;

        // Create new supplier if needed (check existing first to avoid duplicates)
        if (!supplierId && entry.supplierName) {
          const existing = await prisma.supplier.findFirst({
            where: { name: { equals: entry.supplierName, mode: "insensitive" } },
          });
          if (existing) {
            supplierId = existing.id;
          } else {
            const count = await prisma.supplier.count();
            const supplierCode = `SUP-${String(count + 1).padStart(4, "0")}`;
            const newSupplier = await prisma.supplier.create({
              data: { name: entry.supplierName, supplierCode, phone: entry.phone || null, status: "ACTIVE" },
            });
            supplierId = newSupplier.id;
          }
        }

        // Resolve packageIndex to actual package ID
        let packageId = entry.productPackageId || null;
        if (!packageId && entry.packageIndex !== undefined && createdPkgIds[entry.packageIndex]) {
          packageId = createdPkgIds[entry.packageIndex];
        }

        if (supplierId) {
          const existingLink = await prisma.supplierProduct.findFirst({
            where: { supplierId, productId: id, productPackageId: packageId },
          });
          if (existingLink) {
            await prisma.supplierProduct.update({
              where: { id: existingLink.id },
              data: { price: entry.price },
            });
          } else {
            await prisma.supplierProduct.create({
              data: { supplierId, productId: id, productPackageId: packageId, price: entry.price },
            });
          }
        }
      }
    }

    return NextResponse.json(product);
  } catch (err) {
    console.error("[products/[id] PATCH]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await params;

    // Check if referenced by orders, receivings, or stock (can't delete)
    const orderRefs = await prisma.orderItem.count({ where: { productId: id } });
    const stockRefs = await prisma.stockBalance.count({ where: { productId: id } });
    if (orderRefs > 0 || stockRefs > 0) {
      return NextResponse.json({ error: "Cannot delete product: it is referenced by existing orders or stock records" }, { status: 409 });
    }

    // Clean up related records that are safe to delete
    await prisma.$transaction(async (tx) => {
      await tx.supplierProduct.deleteMany({ where: { productId: id } });
      await tx.productPackage.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2003") {
      return NextResponse.json({ error: "Cannot delete product: it is referenced by existing orders, transfers, or stock records" }, { status: 409 });
    }
    console.error("[products/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
