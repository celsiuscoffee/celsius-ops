import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// Suppliers + their linked products + packages for the native New PO
// flow. Mirrors backoffice /api/inventory/suppliers/products exactly so
// the native picker iterates over `supplier.products` instead of a
// global catalog (which is how backoffice has worked from day one — the
// staff-side approach of fetching all products and filtering by
// supplier was missing the SupplierProduct price + package wiring).
//
// Each entry's `price` is the negotiated supplier price; `packageLabel`
// is the unit the supplier sells in (e.g. "1 kg bag"). ADHOC supplier
// is special-cased: it expands into one entry per package since the
// supplier-product mapping doesn't pin a specific package.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const suppliers = await prisma.supplier.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      phone: true,
      leadTimeDays: true,
      supplierCode: true,
      supplierProducts: {
        where: { isActive: true },
        select: {
          price: true,
          productPackageId: true,
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              baseUom: true,
              packages: {
                select: {
                  id: true,
                  packageLabel: true,
                  packageName: true,
                  conversionFactor: true,
                },
              },
            },
          },
          productPackage: {
            select: {
              id: true,
              packageLabel: true,
              packageName: true,
              conversionFactor: true,
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const mapped = suppliers.map((s) => {
    const isAdhoc = s.supplierCode === "ADHOC";
    const products: Array<{
      id: string;
      name: string;
      sku: string;
      packageId: string | null;
      packageLabel: string;
      price: number;
      conversionFactor: number;
    }> = [];

    for (const sp of s.supplierProducts) {
      if (isAdhoc && !sp.productPackageId && sp.product.packages.length > 0) {
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
          packageLabel:
            sp.productPackage?.packageLabel ??
            sp.productPackage?.packageName ??
            sp.product.baseUom,
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
