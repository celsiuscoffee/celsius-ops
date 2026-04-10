import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products/options
 * Products with fields needed by stock check, receiving, wastage, transfer pages.
 */
export async function GET() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      baseUom: true,
      storageArea: true,
      checkFrequency: true,
      groupId: true,
      group: { select: { name: true } },
      packages: {
        select: {
          id: true,
          packageName: true,
          packageLabel: true,
          conversionFactor: true,
          isDefault: true,
        },
      },
      supplierProducts: {
        where: { isActive: true },
        select: {
          price: true,
          supplier: { select: { name: true } },
          productPackage: { select: { packageLabel: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  // Transform to match expected shape
  const result = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    baseUom: p.baseUom,
    storageArea: p.storageArea || "UNCATEGORIZED",
    checkFrequency: p.checkFrequency,
    categoryId: p.groupId,
    category: p.group.name,
    packages: p.packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.packageName,
      label: pkg.packageLabel,
      uom: pkg.packageLabel,
      conversion: Number(pkg.conversionFactor),
      isDefault: pkg.isDefault,
    })),
    suppliers: p.supplierProducts.map((sp) => ({
      name: sp.supplier.name,
      price: Number(sp.price),
      uom: sp.productPackage?.packageLabel || p.baseUom,
    })),
  }));

  return NextResponse.json(result);
}
