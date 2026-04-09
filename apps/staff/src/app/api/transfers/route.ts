import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outletId");

  const where = outletId
    ? { OR: [{ fromOutletId: outletId }, { toOutletId: outletId }] }
    : {};

  const transfers = await prisma.stockTransfer.findMany({
    where,
    include: {
      fromOutlet: true,
      toOutlet: true,
      transferredBy: true,
      items: {
        include: {
          product: true,
          productPackage: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = transfers.map((t) => ({
    id: t.id,
    fromOutlet: t.fromOutlet.name,
    fromOutletCode: t.fromOutlet.code,
    toOutlet: t.toOutlet.name,
    toOutletCode: t.toOutlet.code,
    status: t.status,
    transferredBy: t.transferredBy.name,
    notes: t.notes,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
    items: t.items.map((i) => ({
      id: i.id,
      product: i.product.name,
      sku: i.product.sku,
      package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
      quantity: Number(i.quantity),
    })),
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { fromOutletId, toOutletId, transferredById, notes, items } = body;

  const transfer = await prisma.stockTransfer.create({
    data: {
      fromOutletId,
      toOutletId,
      transferredById,
      status: "PENDING",
      notes: notes || null,
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; quantity: number }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          quantity: i.quantity,
        })),
      },
    },
    include: {
      fromOutlet: true,
      toOutlet: true,
      transferredBy: true,
      items: { include: { product: true, productPackage: true } },
    },
  });

  // Subtract from source outlet immediately when transfer is created (parallel)
  await Promise.all(
    items.map((item: { productId: string; quantity: number }) =>
      adjustStockBalance(fromOutletId, item.productId, -item.quantity),
    ),
  );

  return NextResponse.json(transfer, { status: 201 });
}
