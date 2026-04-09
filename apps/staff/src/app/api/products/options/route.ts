import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products/options
 * Lightweight endpoint returning all products for dropdowns/selectors.
 * Returns only id, name, sku, baseUom — no joins, no pagination.
 */
export async function GET() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      baseUom: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(products);
}
