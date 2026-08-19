import { NextResponse, NextRequest } from "next/server";
import { resolveReceiptPackages } from "@celsius/db";
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

  const rawItems = (items ?? []) as Array<{ productId: string; productPackageId?: string; quantity: number }>;
  if (rawItems.length === 0) {
    return NextResponse.json({ error: "A transfer needs at least one item" }, { status: 400 });
  }
  if (rawItems.some((i) => !i.productId || !Number.isFinite(Number(i.quantity)) || Number(i.quantity) <= 0)) {
    return NextResponse.json({ error: "Every item needs a product and a positive quantity" }, { status: 400 });
  }

  // Resolve every line to a package BEFORE touching stock — the SAME guard the
  // receiving route uses. Transfer lines are counted in PACKAGE units ("5
  // packs") but StockBalance is base UOM. When the web page omitted the
  // package, the old code fell through to conversionFactor 1 and deducted "5
  // packs (1000g)" as 5 base units — silently corrupting the source outlet's
  // balance. A missing package on a multi-package product is now refused;
  // determinable cases (sole package, or a product with no packages) resolve.
  const productIds = [...new Set(rawItems.map((i) => i.productId))];
  const [pkgOptions, products] = await Promise.all([
    prisma.productPackage.findMany({
      where: { productId: { in: productIds } },
      select: { id: true, productId: true, packageLabel: true, conversionFactor: true },
    }),
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
  ]);
  const resolution = resolveReceiptPackages(
    rawItems.map((i) => ({ productId: i.productId, productPackageId: i.productPackageId ?? null })),
    {
      packages: pkgOptions.map((p) => ({ ...p, conversionFactor: Number(p.conversionFactor) })),
      productNames: new Map(products.map((p) => [p.id, p.name])),
    },
  );
  if (!resolution.ok) {
    return NextResponse.json(
      {
        error: "Choose a package for every item before transferring.",
        details: resolution.errors.map((e) => e.message),
      },
      { status: 400 },
    );
  }
  // resolved[] is positional to rawItems — each carries the chosen package id
  // and the base-UOM conversion factor.
  const resolvedLines = rawItems.map((i, idx) => ({
    productId: i.productId,
    quantity: Number(i.quantity),
    productPackageId: resolution.resolved[idx].productPackageId,
    conversionFactor: resolution.resolved[idx].conversionFactor,
  }));

  const transfer = await prisma.stockTransfer.create({
    data: {
      fromOutletId,
      toOutletId,
      transferredById: session.id,
      status: "PENDING",
      notes: notes || null,
      items: {
        create: resolvedLines.map((i) => ({
          productId: i.productId,
          productPackageId: i.productPackageId,
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

  // Subtract from source outlet immediately when transfer is created, in base
  // UOM via the resolved factor (no longer a silent ?? 1 default).
  await Promise.all(
    resolvedLines.map((i) =>
      adjustStockBalance(fromOutletId, i.productId, -i.quantity * i.conversionFactor),
    ),
  );

  return NextResponse.json(transfer, { status: 201 });
}
