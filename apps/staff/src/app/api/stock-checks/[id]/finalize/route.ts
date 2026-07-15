import { NextResponse, NextRequest } from "next/server";
import { isCleanCount, baseQtyByProduct } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { setStockBalance } from "@/lib/stock";
import { checkCountCoverage } from "@/lib/stock-coverage";
import { getSession } from "@/lib/auth";

/**
 * POST /api/stock-checks/[id]/finalize
 *
 * Flips a DRAFT count → SUBMITTED, runs stock balance updates, and stamps
 * the finalizer. Anyone at the outlet (or admin) can finalize.
 *
 * Refuses if any item has a null countedQty — the UI guards this too, but
 * we re-check on the server to avoid race-induced partial finalization.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Optional override for a deliberately partial monthly count (spot check,
  // discontinued lines). Body is optional — parse defensively.
  const body = await req.json().catch(() => ({}));
  const partialReason: string | null =
    typeof body?.partialReason === "string" && body.partialReason.trim()
      ? body.partialReason.trim().slice(0, 300)
      : null;

  const count = await prisma.stockCount.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      outletId: true,
      frequency: true,
      notes: true,
      items: {
        select: {
          productId: true,
          productPackageId: true,
          expectedQty: true,
          countedQty: true,
          productPackage: { select: { conversionFactor: true } },
        },
      },
    },
  });

  if (!count) {
    return NextResponse.json({ error: "Count not found" }, { status: 404 });
  }

  // Permission: any user on the same outlet can finalize. Admins/owners can
  // finalize from any outlet (for cross-outlet ops review).
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && count.outletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot finalize another outlet's count" }, { status: 403 });
  }

  if (count.status !== "DRAFT") {
    return NextResponse.json(
      { error: `Count is already ${count.status}` },
      { status: 409 },
    );
  }

  // Server-side completeness check — every item must have a countedQty.
  // (Frontend disables the button at < 100%, but a stale page could try
  // to finalize before all items synced.)
  const incomplete = count.items.filter((i) => i.countedQty == null);
  if (incomplete.length > 0) {
    return NextResponse.json(
      { error: `${incomplete.length} item(s) not yet counted`, incompleteCount: incomplete.length },
      { status: 400 },
    );
  }

  // Coverage guard — did this count cover the outlet's expected universe for its
  // frequency? Catches short counts (products never loaded onto the sheet), which
  // the per-item completeness check above cannot see. MONTHLY below the floor is
  // blocked unless an explicit partialReason is supplied; DAILY/WEEKLY only warn.
  const coverage = await checkCountCoverage({
    outletId: count.outletId,
    frequency: count.frequency,
    countedItems: count.items,
    excludeStockCountId: count.id,
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

  const now = new Date();

  // A short count (below floor, or a monthly submitted with an explicit partial
  // reason) must never auto-approve — it goes to the manager's review queue with
  // a note, so the gap is seen. Otherwise, zero-variance counts auto-approve.
  const isShort = coverage.belowFloor;
  const autoApprove = !isShort && isCleanCount(count.items);
  const noteAddition = isShort
    ? `${coverage.shortNote}${partialReason ? ` reason: ${partialReason}` : ""}`
    : null;
  const mergedNotes = noteAddition
    ? [count.notes, noteAddition].filter(Boolean).join(" ")
    : undefined;

  // Flip status first so any concurrent finalize attempt sees the new state.
  const updated = await prisma.stockCount.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      status: autoApprove ? "REVIEWED" : "SUBMITTED",
      submittedAt: now,
      finalizedById: session.id,
      finalizedAt: now,
      ...(autoApprove ? { reviewedAt: now } : {}),
      ...(mergedNotes !== undefined ? { notes: mergedNotes } : {}),
    },
  });
  if (updated.count === 0) {
    // Lost the race to another finalize.
    return NextResponse.json({ error: "Already finalized by someone else" }, { status: 409 });
  }

  // Convert each counted line from package units to the product's base UOM
  // (StockBalance is tracked in base UOM everywhere else — receiving, wastage,
  // inventory, par levels). Counting "22 packets" must land as 22 × pack size,
  // not a raw 22. Lines for the same product are summed into one base total.
  const baseTotals = baseQtyByProduct(
    count.items
      .filter((i) => i.countedQty != null)
      .map((i) => ({
        productId: i.productId,
        countedQty: i.countedQty,
        conversionFactor: i.productPackage?.conversionFactor ?? 1,
      })),
  );
  const productIds = [...baseTotals.keys()];

  // A physical count is authoritative for total on-hand, so it writes to the
  // canonical per-product row (productPackageId = null) that receiving and
  // wastage also use. Zero out any leftover per-package balance rows for these
  // products first, otherwise the inventory reader — which sums across all
  // package rows — would double-count them against the fresh base total.
  if (productIds.length > 0) {
    await prisma.stockBalance.updateMany({
      where: { outletId: count.outletId, productId: { in: productIds }, productPackageId: { not: null } },
      data: { quantity: 0, lastUpdated: now },
    });
  }

  // Run stock balance updates — chunked at 20 to bound concurrency.
  const CHUNK = 20;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const chunk = productIds.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((productId) =>
        setStockBalance(count.outletId, productId, baseTotals.get(productId)!, null),
      ),
    );
  }

  return NextResponse.json({ ok: true, finalizedAt: now, autoApproved: autoApprove }, { status: 200 });
}
