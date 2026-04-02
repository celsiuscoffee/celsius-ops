import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Returns suppliers with their linked products + packages for order creation
export async function GET() {
  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    include: {
      supplierProducts: {
        include: {
          product: true,
          productPackage: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone ?? "",
    products: s.supplierProducts.map((sp) => ({
      id: sp.product.id,
      name: sp.product.name,
      sku: sp.product.sku,
      packageId: sp.productPackage?.id ?? null,
      packageLabel: sp.productPackage?.packageLabel ?? sp.productPackage?.packageName ?? sp.product.baseUom,
      price: Number(sp.price),
    })),
  }));

  return NextResponse.json(mapped);
}
