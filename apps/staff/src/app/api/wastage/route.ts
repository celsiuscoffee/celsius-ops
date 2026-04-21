import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outletId") || session.outletId;

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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { outletId, productId, adjustmentType, quantity, costAmount, reason } = body;

  if (!quantity || quantity <= 0) {
    return NextResponse.json({ error: "Quantity must be positive" }, { status: 400 });
  }

  // Server-set: never trust client adjustedById; outlet must match session
  // for non-admin roles.
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && outletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot record wastage for another outlet" }, { status: 403 });
  }

  // Auto-fill cost from cheapest active supplier price when client didn't
  // provide one. Stock is tracked in product baseUom; supplier prices are
  // per package, so divide by conversionFactor to get per-baseUom cost.
  let resolvedCost: number | null = costAmount ?? null;
  if (resolvedCost == null) {
    const sp = await prisma.supplierProduct.findMany({
      where: { productId, isActive: true, productPackage: { isNot: null } },
      select: { price: true, productPackage: { select: { conversionFactor: true } } },
    });
    const perBaseUnit = sp
      .map((s) => {
        const cf = Number(s.productPackage?.conversionFactor ?? 0);
        return cf > 0 ? Number(s.price) / cf : null;
      })
      .filter((v): v is number => v != null && v > 0);
    if (perBaseUnit.length > 0) {
      const cheapest = Math.min(...perBaseUnit);
      resolvedCost = Math.round(cheapest * Math.abs(Number(quantity)) * 100) / 100;
    }
  }

  const adjustment = await prisma.stockAdjustment.create({
    data: {
      outletId,
      productId,
      adjustmentType,
      quantity,
      costAmount: resolvedCost,
      reason: reason || null,
      adjustedById: session.id,
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
