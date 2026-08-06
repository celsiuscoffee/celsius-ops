import { NextResponse, NextRequest } from "next/server";
import {
  isCleanCount,
  baseQtyByProduct,
  evaluateCountFreshness,
  evaluateCountSchedule,
} from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { setStockBalance } from "@/lib/stock";
import { checkCountCoverage } from "@/lib/stock-coverage";
import { getSession } from "@/lib/auth";
import { touchAgentRun } from "@celsius/agents/src/substrate";
import { logAgentMessage } from "@celsius/agents/src/messages";

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

  // Acknowledgement for a count left open past the block window — the counter
  // must say when the stock was actually counted before we accept it.
  const staleReason: string | null =
    typeof body?.staleReason === "string" && body.staleReason.trim()
      ? body.staleReason.trim().slice(0, 300)
      : null;

  // Why a census is being closed outside its scheduled window (weekly off
  // Thursday, monthly away from the month boundary). Required by the schedule
  // guard below before an off-window count is accepted.
  const scheduleReason: string | null =
    typeof body?.scheduleReason === "string" && body.scheduleReason.trim()
      ? body.scheduleReason.trim().slice(0, 300)
      : null;

  const count = await prisma.stockCount.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      outletId: true,
      frequency: true,
      notes: true,
      createdAt: true,
      countDate: true,
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

  // Freshness guard — a count is a point-in-time snapshot, so one left open
  // across trading days no longer describes any single date. Open more than a
  // full day and the count is EXPIRED: a soft block, refused until the counter
  // says when the stock was actually counted. Past the stale window (18h) we
  // allow it but never auto-approve, so a human sees the gap. (Putrajaya counts
  // sat open 6–25 days and silently corrupted every shrinkage figure derived
  // from them.)
  const freshness = evaluateCountFreshness({ createdAt: count.createdAt, now });
  if (freshness.expired && !staleReason) {
    return NextResponse.json(
      {
        error: `This count has been open ${freshness.daysOpen} day(s) — it expired. Stock has moved since it was started, so the numbers no longer describe one date. Start a fresh count, or confirm when the stock was actually counted.`,
        code: "COUNT_EXPIRED",
        hoursOpen: Math.round(freshness.hoursOpen),
        daysOpen: freshness.daysOpen,
        startedAt: count.createdAt,
      },
      { status: 400 },
    );
  }

  // Schedule guard — a census has a window, and one filed outside it is either
  // a mistake or a deliberate exception, never routine. Weekly belongs on
  // Thursday (the outlets' quietest delivery day, 4.1/day vs 15.1 on Monday,
  // and joint-lowest for sales); monthly belongs on the month boundary so the
  // census lines up with the accounting close. Three "monthly" counts landed on
  // 3, 4 and 5 August 2026, each overwriting every balance in the store.
  //
  // Judged on the date the count will be FILED under — for an expired count
  // that is today's date, since it gets re-stamped below. Soft, like the guards
  // above: a reason gets you through, and the count then goes to review rather
  // than auto-approving.
  const effectiveDate = freshness.expired ? now : count.countDate;
  const schedule = evaluateCountSchedule({
    frequency: count.frequency,
    date: effectiveDate,
  });
  if (schedule.offSchedule && !scheduleReason) {
    return NextResponse.json(
      {
        error: `A ${count.frequency.toLowerCase()} count is due ${schedule.expectedLabel}, but this one lands on ${schedule.actualLabel}. Count it in the normal window, or say why it's being done now.`,
        code: "OFF_SCHEDULE",
        frequency: count.frequency,
        expectedLabel: schedule.expectedLabel,
        actualLabel: schedule.actualLabel,
      },
      { status: 400 },
    );
  }

  // A short count (below floor, or a monthly submitted with an explicit partial
  // reason) must never auto-approve — it goes to the manager's review queue with
  // a note, so the gap is seen. Otherwise, zero-variance counts auto-approve.
  // A stale count is held back from auto-approval for the same reason.
  // An off-schedule census is held back from auto-approval for the same reason:
  // it is an exception someone chose to make, so a human should see it.
  const isShort = coverage.belowFloor;
  const autoApprove =
    !isShort && !freshness.stale && !schedule.offSchedule && isCleanCount(count.items);
  const noteAddition = [
    isShort ? `${coverage.shortNote}${partialReason ? ` reason: ${partialReason}` : ""}` : null,
    schedule.offScheduleNote
      ? `${schedule.offScheduleNote}${scheduleReason ? ` reason: ${scheduleReason}` : ""}`
      : null,
    freshness.staleNote
      ? `${freshness.staleNote}${staleReason ? ` counted: ${staleReason}` : ""}`
      : null,
    // An expired count is re-dated below, so record what it was opened as —
    // otherwise the original date is lost and the re-stamp looks like the
    // count simply started today.
    freshness.expired
      ? `[re-dated] opened ${count.countDate.toISOString().slice(0, 10)}, closed ${now
          .toISOString()
          .slice(0, 10)}; countDate moved to the closing date.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
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
      // The balances written below are as-of NOW, so an expired count must be
      // stamped with the day it actually closed. Leaving countDate at the day
      // it was opened is exactly the bug this guard exists for: a 29 Jul count
      // finalized on the 31st was filed as 29 Jul stock.
      ...(freshness.expired ? { countDate: now } : {}),
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

  // Fleet visibility for the auto-approve agent (lives in the staff app, so it
  // was invisible to /agents). Heartbeat on every finalize; post one feed line
  // (notify:false = /agents + daily digest, no real-time ping) when a count
  // clears without a human, so the owner can see the agent working and, if a
  // clean count still looks wrong, reply to question it. Substrate helpers
  // swallow their own errors - this never blocks the finalize.
  await touchAgentRun("stock_count_auto_approve");
  if (autoApprove) {
    await logAgentMessage({
      fromAgent: "stock_count_auto_approve",
      toAgent: "owner",
      kind: "report",
      summary: `Auto-approved a zero-variance stock count (${productIds.length} products), no manager review needed.`,
      refTable: "stock_counts",
      refId: id,
      outletId: count.outletId,
      notify: false,
    });
  }

  return NextResponse.json({ ok: true, finalizedAt: now, autoApproved: autoApprove }, { status: 200 });
}
