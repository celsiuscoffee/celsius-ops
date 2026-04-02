import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");

  const where = branchId
    ? { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] }
    : {};

  const transfers = await prisma.stockTransfer.findMany({
    where,
    include: {
      fromBranch: true,
      toBranch: true,
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
    fromBranch: t.fromBranch.name,
    fromBranchCode: t.fromBranch.code,
    toBranch: t.toBranch.name,
    toBranchCode: t.toBranch.code,
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
  const { fromBranchId, toBranchId, transferredById, notes, items } = body;

  const transfer = await prisma.stockTransfer.create({
    data: {
      fromBranchId,
      toBranchId,
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
      fromBranch: true,
      toBranch: true,
      transferredBy: true,
      items: { include: { product: true, productPackage: true } },
    },
  });

  // Subtract from source branch immediately when transfer is created
  for (const item of items) {
    await adjustStockBalance(fromBranchId, item.productId, -item.quantity);
  }

  return NextResponse.json(transfer, { status: 201 });
}
