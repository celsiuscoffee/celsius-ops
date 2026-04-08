import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { setStockBalance } from "@/lib/stock";

export async function GET() {
  const stockCounts = await prisma.stockCount.findMany({
    select: {
      id: true,
      frequency: true,
      status: true,
      notes: true,
      countDate: true,
      submittedAt: true,
      reviewedAt: true,
      createdAt: true,
      outlet: { select: { name: true, code: true } },
      countedBy: { select: { name: true } },
      items: {
        select: {
          id: true,
          expectedQty: true,
          countedQty: true,
          isConfirmed: true,
          varianceReason: true,
          product: { select: { name: true, sku: true } },
          productPackage: { select: { packageLabel: true, packageName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = stockCounts.map((sc) => ({
    id: sc.id,
    outlet: sc.outlet.name,
    outletCode: sc.outlet.code,
    frequency: sc.frequency,
    countedBy: sc.countedBy.name,
    countDate: sc.countDate.toISOString(),
    status: sc.status,
    notes: sc.notes,
    submittedAt: sc.submittedAt?.toISOString() ?? null,
    reviewedAt: sc.reviewedAt?.toISOString() ?? null,
    createdAt: sc.createdAt.toISOString(),
    items: sc.items.map((i) => ({
      id: i.id,
      product: i.product.name,
      sku: i.product.sku,
      package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
      expectedQty: i.expectedQty ? Number(i.expectedQty) : null,
      countedQty: i.countedQty ? Number(i.countedQty) : null,
      isConfirmed: i.isConfirmed,
      varianceReason: i.varianceReason,
    })),
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outletId, countedById, frequency, notes, items } = body;

  const stockCount = await prisma.stockCount.create({
    data: {
      outletId,
      countedById,
      frequency,
      status: "SUBMITTED",
      submittedAt: new Date(),
      notes: notes || null,
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; expectedQty?: number; countedQty?: number; isConfirmed?: boolean; varianceReason?: string }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          expectedQty: i.expectedQty ?? null,
          countedQty: i.countedQty ?? null,
          isConfirmed: i.isConfirmed ?? false,
          varianceReason: i.varianceReason || null,
        })),
      },
    },
    include: {
      outlet: true,
      countedBy: true,
      items: { include: { product: true, productPackage: true } },
    },
  });

  // Update stock balances from counted quantities (parallel)
  await Promise.all(
    items
      .filter((item: { countedQty?: number }) => item.countedQty !== null && item.countedQty !== undefined)
      .map((item: { productId: string; countedQty: number }) =>
        setStockBalance(outletId, item.productId, item.countedQty),
      ),
  );

  return NextResponse.json(stockCount, { status: 201 });
}
