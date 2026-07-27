import { NextResponse, NextRequest } from "next/server";
import { isCleanCount, baseQtyByProduct } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { setStockBalance } from "@/lib/stock";
import { checkCountCoverage } from "@/lib/stock-coverage";
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
  const partialReason: string | null =
    typeof body?.partialReason === "string" && body.partialReason.trim()
      ? body.partialReason.trim().slice(0, 300)
      : null;

  // Server-set: never trust client-supplied countedById, and require the
  // outlet matches the user's session unless they are OWNER/ADMIN.
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && outletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot submit stock count for another outlet" }, { status: 403 });
  }

  // Coverage guard — this path submits a whole count at once, so guard it the
  // same way as finalize: block a short MONTHLY census (unless an explicit
  // partial reason is given); warn (route to review) on short DAILY/WEEKLY.
  const coverage = await checkCountCoverage({
    outletId,
    frequency: frequency as "DAILY" | "WEEKLY" | "MONTHLY",
    countedItems: items as Array<{ productId: string; countedQty: unknown }>,
  });
  if (coverage.block && !partialReason) {
    return NextResponse.json(
      {
        error: `Only ${coverage.counted} of ${coverage.expected} expected products counted (${Math.round(
          coverage.coverage * 100,
        )}%). Finish the count, or submit a partial count with a reason.`,
        code: "COVERAGE_TOO_LOW",
        expected: coverage.expected,
        counted: coverage.counted,
        missing: coverage.missing,
        missingProductIds: coverage.missingProductIds.slice(0, 100),
      },
      { status: 400 },
    );
  }

  // A short count never auto-approves — it goes to review with a note. Otherwise
  // zero-variance counts auto-approve straight to REVIEWED.
  const now = new Date();
  const isShort = coverage.belowFloor;
  const autoApprove =
    !isShort &&
    isCleanCount(
      (items as Array<{ expectedQty?: number | null; countedQty?: number | null }>).map((i) => ({
        expectedQty: i.expectedQty ?? null,
        countedQty: i.countedQty ?? null,
      })),
    );
  const mergedNotes = isShort
    ? [notes, `${coverage.shortNote}${partialReason ? ` reason: ${partialReason}` : ""}`]
        .filter(Boolean)
        .join(" ")
    : notes || null;

  const stockCount = await prisma.stockCount.create({
    data: {
      outletId,
      countedById: session.id,
      frequency,
      status: autoApprove ? "REVIEWED" : "SUBMITTED",
      submittedAt: now,
      ...(autoApprove ? { reviewedAt: now } : {}),
      notes: mergedNotes,
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
