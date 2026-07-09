import { NextResponse, NextRequest } from "next/server";
import { isCleanCount, baseQtyByProduct } from "@celsius/db";
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

  // Variance baseline comes from the server, never the client. Staff count in
  // package units and the staff flow does not carry a trustworthy expectedQty,
  // so we read the current on-hand from StockBalance (kept in base UOM) and
  // compare in base UOM. Trusting a client-supplied expectedQty meant every
  // count read as "clean" (no baseline) and auto-approved, so real
  // discrepancies never reached a manager. This mirrors the backoffice route
  // at apps/backoffice/src/app/api/inventory/stock-checks.
  type CountLine = {
    productId: string;
    productPackageId?: string | null;
    countedQty?: number | null;
    isConfirmed?: boolean;
    varianceReason?: string;
  };
  const lines = (items as CountLine[]) ?? [];
  const countedProductIds = [...new Set(lines.map((i) => i.productId))];
  const packageIds = [
    ...new Set(
      lines.map((i) => i.productPackageId).filter((x): x is string => !!x),
    ),
  ];

  const [packages, balances] = await Promise.all([
    prisma.productPackage.findMany({
      where: { id: { in: packageIds } },
      select: { id: true, conversionFactor: true },
    }),
    prisma.stockBalance.findMany({
      where: {
        outletId,
        productId: { in: countedProductIds },
        productPackageId: null,
      },
      select: { productId: true, quantity: true },
    }),
  ]);
  const factorByPackage: Record<string, number> = {};
  for (const p of packages) factorByPackage[p.id] = Number(p.conversionFactor) || 1;
  const balanceByProduct: Record<string, number> = {};
  for (const b of balances) balanceByProduct[b.productId] = Number(b.quantity);
  const factorFor = (i: CountLine) =>
    i.productPackageId ? factorByPackage[i.productPackageId] ?? 1 : 1;

  // Counted quantity per product in base UOM (summed across any package lines).
  const countedBaseByProduct: Record<string, number> = {};
  for (const i of lines) {
    if (i.countedQty == null) continue;
    countedBaseByProduct[i.productId] =
      (countedBaseByProduct[i.productId] ?? 0) + Number(i.countedQty) * factorFor(i);
  }

  // Zero-variance counts auto-approve straight to REVIEWED; only counts with a
  // real discrepancy land in the manager's review queue (SUBMITTED). Products
  // with no balance row have no baseline, so isCleanCount skips them.
  const now = new Date();
  const autoApprove = isCleanCount(
    countedProductIds.map((pid) => ({
      expectedQty: pid in balanceByProduct ? balanceByProduct[pid] : null,
      countedQty: pid in countedBaseByProduct ? countedBaseByProduct[pid] : null,
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
        create: lines.map((i) => {
          // Store the expected on-hand in this line's package units so the
          // review screen compares like-for-like against countedQty.
          const balBase =
            i.productId in balanceByProduct ? balanceByProduct[i.productId] : null;
          const expectedQty = balBase == null ? null : balBase / factorFor(i);
          return {
            productId: i.productId,
            productPackageId: i.productPackageId || null,
            expectedQty,
            countedQty: i.countedQty ?? null,
            isConfirmed: i.isConfirmed ?? false,
            varianceReason: i.varianceReason || null,
          };
        }),
      },
    },
    include: {
      outlet: true,
      countedBy: true,
      items: { include: { product: true, productPackage: true } },
    },
  });

  // Update stock balances from counted quantities. Counts happen in package
  // units ("22 packets") but StockBalance is tracked in the product's base UOM,
  // so multiply each line by its package conversionFactor before storing and
  // write to the canonical per-product row (productPackageId = null) that
  // receiving and wastage use. Reads conversionFactor off the created items,
  // which include productPackage.
  const baseTotals = baseQtyByProduct(
    stockCount.items
      .filter((i) => i.countedQty != null)
      .map((i) => ({
        productId: i.productId,
        countedQty: i.countedQty,
        conversionFactor: i.productPackage?.conversionFactor ?? 1,
      })),
  );
  const productIds = [...baseTotals.keys()];

  // Zero any leftover per-package balance rows for these products so the
  // inventory reader (which sums across package rows) doesn't double-count
  // them against the fresh base total.
  if (productIds.length > 0) {
    await prisma.stockBalance.updateMany({
      where: { outletId, productId: { in: productIds }, productPackageId: { not: null } },
      data: { quantity: 0, lastUpdated: now },
    });
  }

  // Monthly counts can have 200+ items — firing them all in parallel exhausts
  // the Supavisor pool and the Vercel function times out before responding.
  // Chunked to bound concurrency.
  const CHUNK_SIZE = 20;
  for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
    const chunk = productIds.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map((productId) =>
        setStockBalance(outletId, productId, baseTotals.get(productId)!, null),
      ),
    );
  }

  return NextResponse.json(stockCount, { status: 201 });
}
