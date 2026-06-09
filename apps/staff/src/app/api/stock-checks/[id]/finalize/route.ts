import { NextResponse, NextRequest } from "next/server";
import { isCleanCount } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { setStockBalance } from "@/lib/stock";
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

  const count = await prisma.stockCount.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      outletId: true,
      items: {
        select: {
          productId: true,
          productPackageId: true,
          expectedQty: true,
          countedQty: true,
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

  const now = new Date();

  // Zero-variance counts auto-approve: there's nothing for a manager to action,
  // so skip the review queue and stamp them REVIEWED on the spot. Only counts
  // with a real discrepancy stay SUBMITTED (pending review).
  const autoApprove = isCleanCount(count.items);

  // Flip status first so any concurrent finalize attempt sees the new state.
  const updated = await prisma.stockCount.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      status: autoApprove ? "REVIEWED" : "SUBMITTED",
      submittedAt: now,
      finalizedById: session.id,
      finalizedAt: now,
      ...(autoApprove ? { reviewedAt: now } : {}),
    },
  });
  if (updated.count === 0) {
    // Lost the race to another finalize.
    return NextResponse.json({ error: "Already finalized by someone else" }, { status: 409 });
  }

  // Run stock balance updates — chunked at 20 to bound concurrency.
  const itemsToUpdate = count.items.filter((i) => i.countedQty != null);
  const CHUNK = 20;
  for (let i = 0; i < itemsToUpdate.length; i += CHUNK) {
    const chunk = itemsToUpdate.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((it) =>
        setStockBalance(
          count.outletId,
          it.productId,
          Number(it.countedQty),
          it.productPackageId ?? null,
        ),
      ),
    );
  }

  return NextResponse.json({ ok: true, finalizedAt: now, autoApproved: autoApprove }, { status: 200 });
}
