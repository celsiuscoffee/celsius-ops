import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  // Only managers may read another outlet's transfers via ?outletId.
  const isManager = ["OWNER", "ADMIN", "MANAGER"].includes(session.role);
  const outletId = isManager
    ? searchParams.get("outletId") || session.outletId
    : session.outletId;

  const where = outletId
    ? { OR: [{ fromOutletId: outletId }, { toOutletId: outletId }] }
    : isManager
      ? {}
      : { id: "__none__" };

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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { fromOutletId, toOutletId, notes, items } = body;

  if (fromOutletId === toOutletId) {
    return NextResponse.json({ error: "Source and destination outlets must be different" }, { status: 400 });
  }

  // Server-set: never trust client-supplied transferredById. Source outlet
  // must be the user's own outlet unless OWNER/ADMIN.
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && fromOutletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot transfer from another outlet" }, { status: 403 });
  }

  const transfer = await prisma.stockTransfer.create({
    data: {
      fromOutletId,
      toOutletId,
      transferredById: session.id,
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

  // Subtract from source outlet immediately when transfer is created.
  // Transfer lines are keyed in PACKAGE units ("5 packs") but StockBalance is
  // base UOM — convert through the line's package factor, same rule as
  // receiving and stock counts. This used to deduct the raw figure, so
  // "5 packs (1000g)" left the sender as 5 grams.
  await Promise.all(
    transfer.items.map((item) =>
      adjustStockBalance(
        fromOutletId,
        item.productId,
        -Number(item.quantity) * Number(item.productPackage?.conversionFactor ?? 1),
      ),
    ),
  );

  return NextResponse.json(transfer, { status: 201 });
}
