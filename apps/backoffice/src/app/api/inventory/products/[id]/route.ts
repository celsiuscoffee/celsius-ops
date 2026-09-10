import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { recordPriceChange } from "@/lib/inventory/price-history";

type PackageInput = {
  id?: string;
  sku?: string;
  packageName: string;
  packageLabel: string;
  conversionFactor: number;
  isDefault?: boolean;
  containsPackageId?: string | null;
  containsPackageIndex?: number;
};

type SupplierInput = {
  supplierId?: string;
  supplierName?: string;
  phone?: string;
  price: number;
  productPackageId?: string;
  packageIndex?: number;
};

/**
 * A package the form dropped can only go if nothing still points at it. Checked
 * BEFORE any write so a blocked delete fails the whole PATCH cleanly (409) instead
 * of a late P2003 after the product, other packages and supplier links were
 * already committed. OrderItem refs are tolerated only when another surviving
 * package has the same conversionFactor to take them over (historical lines
 * keep a meaningful unit); everything else has no reassignment path.
 */
async function packageDeleteBlockers(
  pkgId: string,
  hasSameFactorReplacement: boolean,
): Promise<string[]> {
  const [receiving, countItems, balances, transferItems, orderItems] = await Promise.all([
    prisma.receivingItem.count({ where: { productPackageId: pkgId } }),
    prisma.stockCountItem.count({ where: { productPackageId: pkgId } }),
    prisma.stockBalance.count({ where: { productPackageId: pkgId } }),
    prisma.stockTransferItem.count({ where: { productPackageId: pkgId } }),
    prisma.orderItem.count({ where: { productPackageId: pkgId } }),
  ]);
  const blockers: string[] = [];
  if (receiving > 0) blockers.push(`${receiving} receiving line(s)`);
  if (countItems > 0) blockers.push(`${countItems} stock-count line(s)`);
  if (balances > 0) blockers.push(`${balances} stock balance row(s)`);
  if (transferItems > 0) blockers.push(`${transferItems} transfer line(s)`);
  if (orderItems > 0 && !hasSameFactorReplacement) {
    blockers.push(`${orderItems} order line(s) with no same-size package to move them to`);
  }
  return blockers;
}

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
      packages?: PackageInput[];
      suppliers?: SupplierInput[];
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

    // ── Pre-flight: can every dropped package actually be deleted? ──
    const hasPackages = Array.isArray(packages);
    const existingPackages = hasPackages ? await prisma.productPackage.findMany({ where: { productId: id } }) : [];
    const toDelete = hasPackages
      ? existingPackages.filter((ep) => !packages!.some((p) => p.id === ep.id))
      : [];
    for (const dying of toDelete) {
      const replacement = packages!.some((p) => Number(p.conversionFactor) === Number(dying.conversionFactor));
      const blockers = await packageDeleteBlockers(dying.id, replacement);
      if (blockers.length) {
        return NextResponse.json(
          {
            error:
              `Cannot remove package "${dying.packageLabel || dying.packageName}": it is referenced by ` +
              `${blockers.join(", ")}. Keep the package (you can rename or un-default it) or clear those records first.`,
            packageId: dying.id,
          },
          { status: 409 },
        );
      }
    }

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
    });

    // Index-aligned with the `packages` array from the form: createdPkgIds[i] is
    // the DB id of packages[i]. Hoisted so the suppliers step can resolve a
    // `packageIndex` against the SAME order the form used — the old code re-read
    // the packages with an unordered findMany, so a new price could bind to the
    // wrong package.
    const createdPkgIds: string[] = [];

    // Handle packages: sync (upsert new/updated, delete removed)
    if (hasPackages) {
      // First upsert packages so we have surviving IDs to reassign to
      for (const pkg of packages!) {
        const pkgData = {
          sku: pkg.sku || null,
          packageName: pkg.packageName,
          packageLabel: pkg.packageLabel,
          conversionFactor: pkg.conversionFactor,
          isDefault: pkg.isDefault ?? false,
          containsPackageId: pkg.containsPackageId || null,
        };
        // Try to find existing record by ID (if provided and exists in DB)
        const existingPkg = pkg.id ? existingPackages.find((ep) => ep.id === pkg.id) : null;

        if (existingPkg) {
          await prisma.productPackage.update({
            where: { id: existingPkg.id },
            data: pkgData,
          });
          createdPkgIds.push(existingPkg.id);
        } else {
          const created = await prisma.productPackage.create({
            data: { productId: id, ...pkgData },
          });
          createdPkgIds.push(created.id);
        }
      }
      // Resolve containsPackageIndex for new packages referencing other new packages
      for (let i = 0; i < packages!.length; i++) {
        const pkg = packages![i];
        if (pkg.containsPackageIndex !== undefined && createdPkgIds[pkg.containsPackageIndex]) {
          await prisma.productPackage.update({
            where: { id: createdPkgIds[i] },
            data: { containsPackageId: createdPkgIds[pkg.containsPackageIndex] },
          });
        }
      }

      // Delete packages that are no longer in the incoming list (pre-flight above
      // already proved nothing un-reassignable points at them).
      const survivingPkgs = await prisma.productPackage.findMany({
        where: { id: { in: createdPkgIds } },
      });

      for (const existing of toDelete) {
        // A surviving package with the same conversionFactor takes over order refs
        const replacement = survivingPkgs.find(
          (s) => Number(s.conversionFactor) === Number(existing.conversionFactor)
        );
        const replacementId = replacement?.id || null;

        // Clean up supplier product refs pointing to the deleted package
        // Delete them — they'll be recreated with the new packages from the form
        await prisma.supplierProduct.deleteMany({
          where: { productPackageId: existing.id },
        });
        // Move order item refs (historical data — keep the items) to the same-size survivor
        await prisma.orderItem.updateMany({
          where: { productPackageId: existing.id },
          data: { productPackageId: replacementId },
        });
        // Reassign containsPackageId refs from other packages
        await prisma.productPackage.updateMany({
          where: { containsPackageId: existing.id },
          data: { containsPackageId: replacementId },
        });

        await prisma.productPackage.delete({ where: { id: existing.id } });
      }
    }

    // Handle suppliers: sync supplier-product links
    let priceHistoryWritten = true;
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

        // Resolve packageIndex against the form-ordered createdPkgIds (see above).
        let packageId = entry.productPackageId?.startsWith("new-") ? null : entry.productPackageId || null;
        if (!packageId && entry.packageIndex !== undefined && createdPkgIds[entry.packageIndex]) {
          packageId = createdPkgIds[entry.packageIndex];
        }

        if (supplierId) {
          const existingLink = await prisma.supplierProduct.findFirst({
            where: { supplierId, productId: id, productPackageId: packageId },
          });
          if (existingLink) {
            const ok = await recordPriceChange({
              supplierId,
              productId: id,
              productPackageId: packageId,
              oldPrice: Number(existingLink.price),
              newPrice: Number(entry.price),
            });
            if (!ok) priceHistoryWritten = false;
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

    return NextResponse.json({ ...product, priceHistoryWritten });
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
