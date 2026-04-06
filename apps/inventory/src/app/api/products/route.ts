import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const category = url.searchParams.get("category") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
    ];
  }
  if (category) {
    where.categoryId = category;
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        sku: true,
        categoryId: true,
        category: { select: { name: true } },
        baseUom: true,
        storageArea: true,
        shelfLifeDays: true,
        checkFrequency: true,
        description: true,
        isActive: true,
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
          select: {
            price: true,
            supplier: { select: { name: true } },
            productPackage: { select: { packageLabel: true } },
          },
        },
      },
      orderBy: { name: "asc" },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  const mapped = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category.name,
    categoryId: p.categoryId,
    baseUom: p.baseUom,
    storageArea: p.storageArea ?? "",
    shelfLifeDays: p.shelfLifeDays,
    checkFrequency: p.checkFrequency,
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

  return NextResponse.json({ items: mapped, total, page, limit });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, sku, categoryId, baseUom, storageArea, shelfLifeDays, description, checkFrequency } = body;

  const product = await prisma.product.create({
    data: {
      name,
      sku,
      categoryId,
      baseUom,
      storageArea: storageArea || null,
      shelfLifeDays: shelfLifeDays ? parseInt(shelfLifeDays) : null,
      description: description || null,
      checkFrequency: checkFrequency || "MONTHLY",
    },
  });

  return NextResponse.json(product, { status: 201 });
}
