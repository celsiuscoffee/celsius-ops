import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");

  const where = branchId ? { branchId } : {};

  const parLevels = await prisma.parLevel.findMany({
    where,
    include: {
      product: true,
      branch: true,
    },
    orderBy: { product: { name: "asc" } },
  });

  return NextResponse.json(
    parLevels.map((p) => ({
      id: p.id,
      productId: p.productId,
      productName: p.product.name,
      productSku: p.product.sku,
      baseUom: p.product.baseUom,
      branchId: p.branchId,
      branchName: p.branch.name,
      parLevel: Number(p.parLevel),
      reorderPoint: Number(p.reorderPoint),
      maxLevel: p.maxLevel ? Number(p.maxLevel) : null,
      avgDailyUsage: p.avgDailyUsage ? Number(p.avgDailyUsage) : null,
    })),
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { productId, branchId, parLevel, reorderPoint, maxLevel, avgDailyUsage } = body;

  if (!productId || !branchId || parLevel === undefined || reorderPoint === undefined) {
    return NextResponse.json(
      { error: "productId, branchId, parLevel, and reorderPoint are required" },
      { status: 400 },
    );
  }

  const result = await prisma.parLevel.upsert({
    where: {
      productId_branchId: { productId, branchId },
    },
    create: {
      productId,
      branchId,
      parLevel,
      reorderPoint,
      maxLevel: maxLevel ?? null,
      avgDailyUsage: avgDailyUsage ?? null,
      lastCalculated: new Date(),
    },
    update: {
      parLevel,
      reorderPoint,
      maxLevel: maxLevel ?? null,
      avgDailyUsage: avgDailyUsage ?? null,
      lastCalculated: new Date(),
    },
  });

  return NextResponse.json(result, { status: 201 });
}
