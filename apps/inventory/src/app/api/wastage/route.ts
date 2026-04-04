import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outletId");

  const where = outletId ? { outletId } : {};

  const adjustments = await prisma.stockAdjustment.findMany({
    where,
    include: {
      outlet: true,
      product: true,
      adjustedBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = adjustments.map((a) => ({
    id: a.id,
    outlet: a.outlet.name,
    outletCode: a.outlet.code,
    product: a.product.name,
    sku: a.product.sku,
    adjustmentType: a.adjustmentType,
    quantity: Number(a.quantity),
    costAmount: a.costAmount ? Number(a.costAmount) : null,
    reason: a.reason,
    photoUrl: a.photoUrl,
    adjustedBy: a.adjustedBy.name,
    stockCountId: a.stockCountId,
    createdAt: a.createdAt.toISOString(),
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outletId, productId, adjustmentType, quantity, costAmount, reason, adjustedById } = body;

  const adjustment = await prisma.stockAdjustment.create({
    data: {
      outletId,
      productId,
      adjustmentType,
      quantity,
      costAmount: costAmount ?? null,
      reason: reason || null,
      adjustedById,
    },
    include: {
      outlet: true,
      product: true,
      adjustedBy: true,
    },
  });

  // Wastage subtracts from stock balance
  await adjustStockBalance(outletId, productId, -quantity);

  return NextResponse.json(adjustment, { status: 201 });
}
