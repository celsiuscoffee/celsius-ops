import { NextResponse, NextRequest } from "next/server";
import { isCleanCount } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { setStockBalance } from "@/lib/stock";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
          product: { select: { name: true, sku: true, baseUom: true } },
          productPackage: { select: { packageLabel: true, packageName: true, conversionFactor: true } },
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
      baseUom: i.product.baseUom,
      package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
      packageConversion: i.productPackage?.conversionFactor ? Number(i.productPackage.conversionFactor) : 0,
      expectedQty: i.expectedQty ? Number(i.expectedQty) : null,
      countedQty: i.countedQty ? Number(i.countedQty) : null,
      isConfirmed: i.isConfirmed,
      varianceReason: i.varianceReason,
    })),
  }));

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { outletId, countedById, frequency, notes, items } = body;

  // Snapshot current stock balances BEFORE updating (for variance calculation)
  const productIds = items.map((i: { productId: string }) => i.productId);
  const currentBalances = await prisma.stockBalance.findMany({
    where: { outletId, productId: { in: productIds } },
    select: { productId: true, quantity: true },
  });
  const balanceMap: Record<string, number> = {};
  for (const b of currentBalances) {
    balanceMap[b.productId] = Number(b.quantity);
  }

  // Zero-variance counts auto-approve straight to REVIEWED; only counts with a
  // real discrepancy against the snapshotted balance need a manager's review.
  const now = new Date();
  const autoApprove = isCleanCount(
    (items as Array<{ productId: string; countedQty?: number | null }>).map((i) => ({
      expectedQty: balanceMap[i.productId] ?? null,
      countedQty: i.countedQty ?? null,
    })),
  );

  const stockCount = await prisma.stockCount.create({
    data: {
      outletId,
      countedById,
      frequency,
      status: autoApprove ? "REVIEWED" : "SUBMITTED",
      submittedAt: now,
      ...(autoApprove ? { reviewedAt: now } : {}),
      notes: notes || null,
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; countedQty?: number; isConfirmed?: boolean }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          expectedQty: balanceMap[i.productId] ?? null,
          countedQty: i.countedQty ?? null,
          isConfirmed: i.isConfirmed ?? false,
        })),
      },
    },
    include: {
      outlet: true,
      countedBy: true,
      items: { include: { product: true, productPackage: true } },
    },
  });

  // Update stock balances from counted quantities (in base UOM)
  await Promise.all(
    items
      .filter((item: { countedQty?: number }) => item.countedQty !== null && item.countedQty !== undefined)
      .map((item: { productId: string; countedQty: number }) =>
        setStockBalance(outletId, item.productId, item.countedQty),
      ),
  );

  return NextResponse.json(stockCount, { status: 201 });
}
