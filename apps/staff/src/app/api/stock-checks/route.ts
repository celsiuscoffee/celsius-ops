import { NextResponse, NextRequest } from "next/server";
import { isCleanCount } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { setStockBalance } from "@/lib/stock";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const outletId = url.searchParams.get("outletId") || session.outletId;
  const where = outletId ? { outletId } : {};

  const stockCounts = await prisma.stockCount.findMany({
    where,
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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { outletId, frequency, notes, items } = body;

  // Server-set: never trust client-supplied countedById, and require the
  // outlet matches the user's session unless they are OWNER/ADMIN.
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && outletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot submit stock count for another outlet" }, { status: 403 });
  }

  // Zero-variance counts auto-approve straight to REVIEWED; only counts with a
  // real discrepancy land in the manager's review queue (SUBMITTED).
  const now = new Date();
  const autoApprove = isCleanCount(
    (items as Array<{ expectedQty?: number | null; countedQty?: number | null }>).map((i) => ({
      expectedQty: i.expectedQty ?? null,
      countedQty: i.countedQty ?? null,
    })),
  );

  const stockCount = await prisma.stockCount.create({
    data: {
      outletId,
      countedById: session.id,
      frequency,
      status: autoApprove ? "REVIEWED" : "SUBMITTED",
      submittedAt: now,
      ...(autoApprove ? { reviewedAt: now } : {}),
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

  // Update stock balances from counted quantities. Monthly counts can have
  // 200+ items — firing them all in parallel exhausts the Supavisor pool
  // and the Vercel function times out before responding (the StockCount
  // insert above still succeeds, so the user sees "submit doesn't work"
  // and keeps tapping, producing duplicate StockCount rows). Chunked to
  // bound concurrency.
  const itemsToUpdate = items.filter(
    (item: { countedQty?: number | null }) =>
      item.countedQty !== null && item.countedQty !== undefined,
  ) as Array<{ productId: string; countedQty: number; productPackageId?: string | null }>;

  const CHUNK_SIZE = 20;
  for (let i = 0; i < itemsToUpdate.length; i += CHUNK_SIZE) {
    const chunk = itemsToUpdate.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((item) =>
        setStockBalance(outletId, item.productId, item.countedQty, item.productPackageId ?? null),
      ),
    );
  }

  return NextResponse.json(stockCount, { status: 201 });
}
