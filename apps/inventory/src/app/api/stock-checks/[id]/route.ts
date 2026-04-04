import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stockCount = await prisma.stockCount.findUnique({
    where: { id },
    include: {
      outlet: true,
      countedBy: true,
      items: {
        include: {
          product: true,
          productPackage: true,
        },
      },
    },
  });
  if (!stockCount) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mapped = {
    id: stockCount.id,
    outlet: stockCount.outlet.name,
    outletCode: stockCount.outlet.code,
    frequency: stockCount.frequency,
    countedBy: stockCount.countedBy.name,
    countDate: stockCount.countDate.toISOString(),
    status: stockCount.status,
    notes: stockCount.notes,
    submittedAt: stockCount.submittedAt?.toISOString() ?? null,
    reviewedAt: stockCount.reviewedAt?.toISOString() ?? null,
    createdAt: stockCount.createdAt.toISOString(),
    items: stockCount.items.map((i) => ({
      id: i.id,
      product: i.product.name,
      sku: i.product.sku,
      package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
      expectedQty: i.expectedQty ? Number(i.expectedQty) : null,
      countedQty: i.countedQty ? Number(i.countedQty) : null,
      isConfirmed: i.isConfirmed,
      varianceReason: i.varianceReason,
    })),
  };

  return NextResponse.json(mapped);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  const data: Record<string, unknown> = { status };

  if (status === "REVIEWED") {
    data.reviewedAt = new Date();
  }

  const stockCount = await prisma.stockCount.update({
    where: { id },
    data,
  });

  return NextResponse.json(stockCount);
}
