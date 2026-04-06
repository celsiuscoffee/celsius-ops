import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { supplierCode: { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
    ];
  }

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      select: {
        id: true,
        name: true,
        supplierCode: true,
        location: true,
        phone: true,
        email: true,
        status: true,
        leadTimeDays: true,
        tags: true,
        supplierProducts: {
          select: {
            id: true,
            productId: true,
            price: true,
            product: { select: { name: true, sku: true, baseUom: true } },
            productPackage: { select: { packageLabel: true, packageName: true } },
          },
        },
      },
      orderBy: { name: "asc" },
      skip,
      take: limit,
    }),
    prisma.supplier.count({ where }),
  ]);

  const mapped = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    code: s.supplierCode,
    location: s.location ?? "",
    phone: s.phone ?? "",
    email: s.email ?? "",
    status: s.status,
    leadTimeDays: s.leadTimeDays,
    tags: s.tags,
    products: s.supplierProducts.map((sp) => ({
      id: sp.id,
      productId: sp.productId,
      name: sp.product.name,
      sku: sp.product.sku,
      price: Number(sp.price),
      uom: sp.productPackage?.packageLabel ?? sp.productPackage?.packageName ?? sp.product.baseUom,
    })),
  }));

  return NextResponse.json({ items: mapped, total, page, limit });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, supplierCode, phone, email, location, leadTimeDays } = body;

  const supplier = await prisma.supplier.create({
    data: {
      name,
      supplierCode: supplierCode || null,
      phone: phone || null,
      email: email || null,
      location: location || null,
      leadTimeDays: leadTimeDays ? parseInt(leadTimeDays) : 1,
    },
  });

  return NextResponse.json(supplier, { status: 201 });
}
