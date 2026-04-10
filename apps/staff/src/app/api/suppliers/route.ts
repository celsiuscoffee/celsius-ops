import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      supplierProducts: {
        where: { isActive: true },
        select: {
          product: {
            select: { id: true, name: true, sku: true, baseUom: true },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const result = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    products: s.supplierProducts.map((sp) => ({
      id: sp.product.id,
      name: sp.product.name,
      sku: sp.product.sku,
      uom: sp.product.baseUom,
    })),
  }));

  return NextResponse.json(result);
}
