import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outletId");

  const where: Record<string, unknown> = { adjustmentType: "WASTAGE" };
  if (outletId) where.outletId = outletId;

  const adjustments = await prisma.stockAdjustment.findMany({
    where,
    include: {
      product: true,
      adjustedBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = adjustments.map((a) => ({
    id: a.id,
    product: a.product.name,
    sku: a.product.sku,
    adjustmentType: a.adjustmentType,
    quantity: Number(a.quantity),
    costAmount: a.costAmount ? Number(a.costAmount) : null,
    reason: a.reason,
    adjustedBy: a.adjustedBy.name,
    createdAt: a.createdAt.toISOString(),
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outletId, productId, adjustmentType, quantity, costAmount, reason, notes, adjustedById } = body;

  if (!outletId || !productId || !quantity || !adjustedById) {
    return NextResponse.json({ error: "outletId, productId, quantity, and adjustedById are required" }, { status: 400 });
  }

  const adjustment = await prisma.stockAdjustment.create({
    data: {
      outletId,
      productId,
      adjustmentType: adjustmentType || "WASTAGE",
      quantity,
      costAmount: costAmount ?? null,
      reason: reason || notes || null,
      adjustedById,
    },
    include: {
      product: true,
      adjustedBy: true,
    },
  });

  // Subtract from stock balance
  await adjustStockBalance(outletId, productId, -quantity);

  return NextResponse.json({
    id: adjustment.id,
    product: adjustment.product.name,
    sku: adjustment.product.sku,
    adjustmentType: adjustment.adjustmentType,
    quantity: Number(adjustment.quantity),
    costAmount: adjustment.costAmount ? Number(adjustment.costAmount) : null,
    reason: adjustment.reason,
    adjustedBy: adjustment.adjustedBy.name,
    createdAt: adjustment.createdAt.toISOString(),
  }, { status: 201 });
}
