import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const suppliers = await prisma.supplier.findMany({
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

  return NextResponse.json(mapped);
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
