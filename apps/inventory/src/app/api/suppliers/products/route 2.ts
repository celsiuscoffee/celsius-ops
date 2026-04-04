import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Returns suppliers with their linked products + packages for order creation
export async function GET() {
  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      phone: true,
      leadTimeDays: true,
      supplierProducts: {
        select: {
          price: true,
          product: { select: { id: true, name: true, sku: true, baseUom: true } },
          productPackage: { select: { id: true, packageLabel: true, packageName: true, conversionFactor: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone ?? "",
    leadTimeDays: s.leadTimeDays,
    products: s.supplierProducts.map((sp) => ({
      id: sp.product.id,
      name: sp.product.name,
      sku: sp.product.sku,
      packageId: sp.productPackage?.id ?? null,
      packageLabel: sp.productPackage?.packageLabel ?? sp.productPackage?.packageName ?? sp.product.baseUom,
      price: Number(sp.price),
      conversionFactor: Number(sp.productPackage?.conversionFactor) || 1,
    })),
  }));

  return NextResponse.json(mapped);
}
