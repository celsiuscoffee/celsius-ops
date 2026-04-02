import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const products = await prisma.product.findMany({
    include: {
      category: true,
      packages: true,
      supplierProducts: {
        include: {
          supplier: true,
          productPackage: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category.name,
    categoryId: p.categoryId,
    baseUom: p.baseUom,
    storageArea: p.storageArea ?? "",
    shelfLifeDays: p.shelfLifeDays,
    description: p.description ?? "",
    isActive: p.isActive,
    packages: p.packages.map((pkg) => ({
      id: pkg.id,
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
  const { name, sku, categoryId, baseUom, storageArea, shelfLifeDays, description } = body;

  const product = await prisma.product.create({
    data: {
      name,
      sku,
      categoryId,
      baseUom,
      storageArea: storageArea || null,
      shelfLifeDays: shelfLifeDays ? parseInt(shelfLifeDays) : null,
      description: description || null,
    },
  });

  return NextResponse.json(product, { status: 201 });
}
