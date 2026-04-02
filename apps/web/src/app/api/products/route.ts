import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const products = await prisma.product.findMany({
    include: {
      category: true,
      packages: true,
      supplierProducts: {
        include: { supplier: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category?.name ?? "",
    baseUom: p.baseUom,
    storageArea: p.storageArea ?? "",
    shelfLife: null,
    packages: p.packages.map((pkg) => ({
      name: pkg.packageName,
      uom: pkg.packageLabel ?? pkg.packageName,
      conversion: Number(pkg.conversionFactor),
    })),
    suppliers: [
      ...new Set(p.supplierProducts.map((sp) => sp.supplier.name)),
    ],
  }));

  return NextResponse.json(mapped);
}
