import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
          containsPackageId: true,
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
      containsPackageId: pkg.containsPackageId ?? null,
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
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    packages?: { sku?: string; packageName: string; packageLabel: string; conversionFactor: number; isDefault?: boolean; containsPackageId?: string; containsPackageIndex?: number }[];
    suppliers?: { supplierId?: string; supplierName?: string; phone?: string; price: number; productPackageId?: string; packageIndex?: number }[];
  };

  const createdPackageIds: string[] = [];
  if (packages && Array.isArray(packages)) {
    // First pass: create all packages without containsPackageId
    for (const pkg of packages) {
      const created = await prisma.productPackage.create({
        data: {
          productId: product.id,
          sku: pkg.sku || null,
          packageName: pkg.packageName,
          packageLabel: pkg.packageLabel,
          conversionFactor: pkg.conversionFactor,
          isDefault: pkg.isDefault ?? false,
          containsPackageId: pkg.containsPackageId || null,
        },
      });
      createdPackageIds.push(created.id);
    }
    // Second pass: resolve containsPackageIndex references
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      if (pkg.containsPackageIndex !== undefined && createdPackageIds[pkg.containsPackageIndex]) {
        await prisma.productPackage.update({
          where: { id: createdPackageIds[i] },
          data: { containsPackageId: createdPackageIds[pkg.containsPackageIndex] },
        });
      }
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

      // Resolve packageIndex to actual package ID for newly created packages
      let packageId = entry.productPackageId || null;
      if (!packageId && entry.packageIndex !== undefined && createdPackageIds[entry.packageIndex]) {
        packageId = createdPackageIds[entry.packageIndex];
      }

      if (supplierId) {
        await prisma.supplierProduct.create({
          data: {
            supplierId,
            productId: product.id,
            productPackageId: packageId,
            price: entry.price,
          },
        });
      }
    }
  }

  // Auto-link to ADHOC supplier so product is available for pay & claim
  const adhocSupplier = await prisma.supplier.findFirst({ where: { supplierCode: "ADHOC" } });
  if (adhocSupplier) {
    await prisma.supplierProduct.create({
      data: {
        supplierId: adhocSupplier.id,
        productId: product.id,
        price: 0,
      },
    }).catch(() => { /* already linked */ });
  }

  return NextResponse.json(product, { status: 201 });
}
