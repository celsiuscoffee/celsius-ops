import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

// Returns suppliers with their linked products + packages for order creation
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      phone: true,
      leadTimeDays: true,
      supplierCode: true,
      supplierProducts: {
        select: {
          price: true,
          productPackageId: true,
          product: {
            select: {
              id: true, name: true, sku: true, baseUom: true,
              packages: { select: { id: true, packageLabel: true, packageName: true, conversionFactor: true } },
            },
          },
          productPackage: { select: { id: true, packageLabel: true, packageName: true, conversionFactor: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = suppliers.map((s) => {
    // For ADHOC supplier: expand products without packageId to show all package variants
    const isAdhoc = s.supplierCode === "ADHOC";

    const products: { id: string; name: string; sku: string; packageId: string | null; packageLabel: string; price: number; conversionFactor: number }[] = [];

    for (const sp of s.supplierProducts) {
      if (isAdhoc && !sp.productPackageId && sp.product.packages.length > 0) {
        // Expand into one entry per package
        for (const pkg of sp.product.packages) {
          products.push({
            id: sp.product.id,
            name: sp.product.name,
            sku: sp.product.sku,
            packageId: pkg.id,
            packageLabel: pkg.packageLabel ?? pkg.packageName,
            price: Number(sp.price),
            conversionFactor: Number(pkg.conversionFactor) || 1,
          });
        }
      } else {
        products.push({
          id: sp.product.id,
          name: sp.product.name,
          sku: sp.product.sku,
          packageId: sp.productPackage?.id ?? null,
          packageLabel: sp.productPackage?.packageLabel ?? sp.productPackage?.packageName ?? sp.product.baseUom,
          price: Number(sp.price),
          conversionFactor: Number(sp.productPackage?.conversionFactor) || 1,
        });
      }
    }

    return {
      id: s.id,
      name: s.name,
      phone: s.phone ?? "",
      leadTimeDays: s.leadTimeDays,
      products,
    };
  });

  return NextResponse.json(mapped);
}
