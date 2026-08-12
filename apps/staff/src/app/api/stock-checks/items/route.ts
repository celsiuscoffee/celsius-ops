import { NextResponse, NextRequest } from "next/server";
import { autoRefreshOnExpiry, evaluateCountFreshness } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * POST /api/stock-checks/items
 *
 * Collaborative-count item save. Finds-or-creates the active DRAFT count
 * for (outlet, frequency) and upserts the given items, stamping
 * countedById = session.id on each.
 *
 * Conflict detection: when `expectedPriorCountedById` is provided on an
 * item, the upsert refuses if the current row's countedById doesn't match
 * (someone else counted it since the frontend last read). Returns 409
 * with the conflicting items so the UI can prompt "Ameir already counted
 * this — overwrite?".
 *
 * Body:
 *   {
 *     frequency: "DAILY" | "WEEKLY" | "MONTHLY",
 *     items: Array<{
 *       productId: string,
 *       productPackageId?: string | null,
 *       countedQty: number | null,
 *       expectedPriorCountedById?: string | null,  // for conflict check
 *     }>
 *   }
 *
 * Response (200): { countId, items: [...], conflicts: [] }
 * Response (409): { conflicts: [{ productId, countedBy, countedQty }] }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.outletId) {
    return NextResponse.json({ error: "No outlet on session" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || !body.frequency) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const frequency = body.frequency as "DAILY" | "WEEKLY" | "MONTHLY";
  const incoming = body.items as Array<{
    productId: string;
    productPackageId?: string | null;
    countedQty: number | null;
    expectedPriorCountedById?: string | null;
  }>;

  // What to do when the open draft has expired (see the soft block below).
  // Absent → the request is refused with COUNT_EXPIRED so the counter chooses.
  const expiredAction: "new" | "continue" | null =
    body.expiredAction === "new" || body.expiredAction === "continue" ? body.expiredAction : null;

  // 1. Find-or-create the active DRAFT count for this outlet+frequency.
  //    Race-safe enough: if two users hit this endpoint simultaneously, the
  //    second read sees the first's just-created row. If both miss (rare, ~10ms
  //    window), both create — the newest wins on the next read. A proper fix
  //    would be a partial unique index on (outletId, frequency) WHERE
  //    status='DRAFT' — deferred.
  //
  //    Expiry (owner's rule): a draft open more than a full day no longer
  //    describes one date, so it is never silently reused. Only a *fresh* draft
  //    is picked up automatically; an expired one soft-blocks the write until
  //    the counter chooses what to do with it (see 1a).
  const now = new Date();

  const openDrafts = await prisma.stockCount.findMany({
    where: { outletId: session.outletId, frequency, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, countDate: true, notes: true },
    take: 10,
  });
  // Judged from countDate, not createdAt: choosing "continue" re-dates the
  // draft to today, which is exactly the blessing that should stop the soft
  // block. On a never-re-dated draft the two are the same instant. (Judging
  // from createdAt made every save after a "continue" re-run the re-date and
  // append the [re-dated] note again.) Finalize still judges from createdAt —
  // a continued count spans days and must never auto-approve.
  const isExpired = (d: { countDate: Date }) =>
    evaluateCountFreshness({ createdAt: d.countDate, now }).expired;

  let count = openDrafts.find((d) => !isExpired(d)) ?? null;

  // 1a. Expiry soft block. Counting on into a day-old draft silently files
  //     today's shelves under the date it was opened — the exact defect that
  //     made Putrajaya's shrinkage figures meaningless. Refuse the write and
  //     make the counter pick:
  //       "new"      → leave the stale draft alone, start a fresh count today
  //       "continue" → keep the draft, but re-date it to today, because that
  //                    is the date its remaining lines are being counted on
  //     Soft, not hard: the draft's existing lines are real work, and nothing
  //     is discarded without the counter saying so.
  const expiredDraft = count ? null : openDrafts.find(isExpired);
  // DAILY counts auto-refresh: an expired daily draft is abandoned without a
  // prompt and a fresh sheet is created below — see autoRefreshOnExpiry.
  if (expiredDraft && !autoRefreshOnExpiry(frequency)) {
    const freshness = evaluateCountFreshness({ createdAt: expiredDraft.createdAt, now });
    if (!expiredAction) {
      return NextResponse.json(
        {
          error: `This count was started ${freshness.daysOpen} day(s) ago and has expired. Counting more into it would file today's stock under ${expiredDraft.countDate
            .toISOString()
            .slice(0, 10)}. Start a new count for today, or continue this one and re-date it.`,
          code: "COUNT_EXPIRED",
          countId: expiredDraft.id,
          startedAt: expiredDraft.createdAt,
          countDate: expiredDraft.countDate,
          hoursOpen: Math.round(freshness.hoursOpen),
          daysOpen: freshness.daysOpen,
        },
        { status: 409 },
      );
    }
    if (expiredAction === "continue") {
      // The count carries on, so it belongs to today. Re-dating it is the
      // whole point: the alternative is a snapshot filed under a date nobody
      // counted on.
      count = await prisma.stockCount.update({
        where: { id: expiredDraft.id },
        data: {
          countDate: now,
          notes: [
            expiredDraft.notes,
            `[re-dated] opened ${expiredDraft.countDate
              .toISOString()
              .slice(0, 10)}, counting continued ${now
              .toISOString()
              .slice(0, 10)}; countDate moved forward. Earlier lines may pre-date it.`,
          ]
            .filter(Boolean)
            .join(" "),
        },
        select: { id: true, createdAt: true, countDate: true, notes: true },
      });
    }
    // "new" falls through to the create below. The stale draft stays a DRAFT
    // (its lines are evidence of what was counted) but is never picked up
    // again — the fresh count now satisfies the non-expired lookup above.
  }

  if (!count) {
    count = await prisma.stockCount.create({
      data: {
        outletId: session.outletId,
        countedById: session.id,
        frequency,
        status: "DRAFT",
      },
      select: { id: true, createdAt: true, countDate: true, notes: true },
    });
  }

  // 2. Conflict check — for items where the client said "I last saw this
  //    counted by X (or nobody)", refuse if the current row was counted
  //    by someone else. Skips check when expectedPriorCountedById is
  //    `undefined` (initial save, no prior state assumed).
  const itemsWithExpectation = incoming.filter(
    (it) => it.expectedPriorCountedById !== undefined,
  );
  const conflicts: Array<{
    productId: string;
    productPackageId: string | null;
    countedById: string | null;
    countedByName: string | null;
    countedQty: number | null;
  }> = [];

  if (itemsWithExpectation.length > 0) {
    const existing = await prisma.stockCountItem.findMany({
      where: {
        stockCountId: count.id,
        OR: itemsWithExpectation.map((it) => ({
          productId: it.productId,
          productPackageId: it.productPackageId ?? null,
        })),
      },
      select: {
        productId: true,
        productPackageId: true,
        countedById: true,
        countedQty: true,
        countedBy: { select: { name: true } },
      },
    });

    for (const it of itemsWithExpectation) {
      const cur = existing.find(
        (e) =>
          e.productId === it.productId &&
          (e.productPackageId ?? null) === (it.productPackageId ?? null),
      );
      if (!cur) continue; // no existing row → no conflict (first to count)
      // Current row was counted by a different user than what the client saw.
      // Don't flag if the current counter IS the requester — they're updating
      // their own prior count, which is always allowed.
      if (
        cur.countedById !== it.expectedPriorCountedById &&
        cur.countedById !== session.id
      ) {
        conflicts.push({
          productId: it.productId,
          productPackageId: it.productPackageId ?? null,
          countedById: cur.countedById,
          countedByName: cur.countedBy?.name ?? null,
          countedQty: cur.countedQty ? Number(cur.countedQty) : null,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    return NextResponse.json({ conflicts }, { status: 409 });
  }

  // 3. Upsert items in chunks of 20 (same pattern as the bulk balance update)
  //    to avoid pool exhaustion on monthly counts where 235 items get saved.
  //    Note: Prisma's typed compound-unique upsert requires a non-null
  //    productPackageId. When packageId IS null we fall back to a
  //    findFirst+update/create dance — same pattern as setStockBalance.
  const countId = count.id;

  async function upsertOne(it: typeof incoming[number]) {
    const pkgId = it.productPackageId ?? null;
    const createData = {
      stockCountId: countId,
      productId: it.productId,
      productPackageId: pkgId,
      countedQty: it.countedQty,
      isConfirmed: it.countedQty != null,
      countedById: session!.id,
      countedAt: now,
    };
    const updateData = {
      countedQty: it.countedQty,
      isConfirmed: it.countedQty != null,
      countedById: session!.id,
      countedAt: now,
    };

    if (pkgId !== null) {
      await prisma.stockCountItem.upsert({
        where: {
          stockCountId_productId_productPackageId: {
            stockCountId: countId,
            productId: it.productId,
            productPackageId: pkgId,
          },
        },
        create: createData,
        update: updateData,
      });
    } else {
      const existing = await prisma.stockCountItem.findFirst({
        where: { stockCountId: countId, productId: it.productId, productPackageId: null },
        select: { id: true },
      });
      if (existing) {
        await prisma.stockCountItem.update({ where: { id: existing.id }, data: updateData });
      } else {
        await prisma.stockCountItem.create({ data: createData });
      }
    }
  }

  const CHUNK = 20;
  for (let i = 0; i < incoming.length; i += CHUNK) {
    const chunk = incoming.slice(i, i + CHUNK);
    await Promise.all(chunk.map(upsertOne));
  }

  // 4. Return the up-to-date item list so the client can reconcile.
  const items = await prisma.stockCountItem.findMany({
    where: { stockCountId: count.id },
    select: {
      id: true,
      productId: true,
      productPackageId: true,
      countedQty: true,
      isConfirmed: true,
      countedById: true,
      countedAt: true,
      countedBy: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ countId: count.id, items, conflicts: [] });
}
