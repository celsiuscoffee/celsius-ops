import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const itemType = searchParams.get("itemType");

  const where: Record<string, string> = {};
  if (itemType) where.itemType = itemType;

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      sku: true,
      groupId: true,
      group: { select: { name: true } },
      itemType: true,
      baseUom: true,
      storageArea: true,
      shelfLifeDays: true,
      checkFrequency: true,
      description: true,
      isActive: true,
      packages: {
        select: {
          id: true,
          sku: true,
          packageName: true,
          packageLabel: true,
          conversionFactor: true,
          isDefault: true,
        },
      },
      supplierProducts: {
        select: {
          price: true,
          supplier: { select: { name: true } },
          productPackage: { select: { packageLabel: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    group: p.group.name,
    groupId: p.groupId,
    itemType: p.itemType,
    baseUom: p.baseUom,
    storageArea: p.storageArea ?? "",
    shelfLifeDays: p.shelfLifeDays,
    checkFrequency: p.checkFrequency,
    description: p.description ?? "",
    isActive: p.isActive,
    packages: p.packages.map((pkg) => ({
      id: pkg.id,
      sku: pkg.sku ?? "",
      name: pkg.packageName,
      label: pkg.packageLabel,
      uom: pkg.packageLabel ?? pkg.packageName,
      conversion: Number(pkg.conversionFactor),
      conversionFactor: Number(pkg.conversionFactor),
      isDefault: pkg.isDefault,
    })),
    suppliers: p.supplierProducts.map((sp) => ({
      name: sp.supplier.name,
      price: Number(sp.price),
      uom: sp.productPackage?.packageLabel ?? p.baseUom,
    })),
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, sku, groupId, baseUom, storageArea, shelfLifeDays, description, checkFrequency, itemType, suppliers } = body;

  const product = await prisma.product.create({
    data: {
      name,
      sku,
      groupId,
      baseUom,
      itemType: itemType || "INGREDIENT",
      storageArea: storageArea || null,
      shelfLifeDays: shelfLifeDays ? parseInt(shelfLifeDays) : null,
      description: description || null,
      checkFrequency: checkFrequency || "MONTHLY",
    },
  });

  // Handle packages array
  const { packages, suppliers: suppliersInput } = body as {
    packages?: { sku?: string; packageName: string; packageLabel: string; conversionFactor: number; isDefault?: boolean }[];
    suppliers?: { supplierId?: string; supplierName?: string; phone?: string; price: number; productPackageId?: string }[];
  };

  if (packages && Array.isArray(packages)) {
    for (const pkg of packages) {
      await prisma.productPackage.create({
        data: {
          productId: product.id,
          sku: pkg.sku || null,
          packageName: pkg.packageName,
          packageLabel: pkg.packageLabel,
          conversionFactor: pkg.conversionFactor,
          isDefault: pkg.isDefault ?? false,
        },
      });
    }
  }

  // Handle suppliers array
  if (suppliersInput && Array.isArray(suppliersInput)) {
    for (const entry of suppliersInput) {
      let supplierId = entry.supplierId;

      if (!supplierId && entry.supplierName) {
        const count = await prisma.supplier.count();
        const supplierCode = `SUP-${String(count + 1).padStart(4, "0")}`;
        const newSupplier = await prisma.supplier.create({
          data: {
            name: entry.supplierName,
            supplierCode,
            phone: entry.phone || null,
            status: "ACTIVE",
          },
        });
        supplierId = newSupplier.id;
      }

      if (supplierId) {
        await prisma.supplierProduct.create({
          data: {
            supplierId,
            productId: product.id,
            productPackageId: entry.productPackageId || null,
            price: entry.price,
          },
        });
      }
    }
  }

  return NextResponse.json(product, { status: 201 });
}
