import { NextResponse, NextRequest } from "next/server";
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

  // 1. Find-or-create the active DRAFT count for this outlet+frequency.
  //    Race-safe enough: if two users hit this endpoint simultaneously, the
  //    second findFirst sees the first's just-created row. If both miss
  //    (rare, ~10ms window), both create — we'd have 2 drafts, which the
  //    frontend handles by picking the oldest via orderBy createdAt asc
  //    on the active endpoint. A proper fix would be a partial unique
  //    index on (outletId, frequency) WHERE status='DRAFT' — deferred.
  let count = await prisma.stockCount.findFirst({
    where: { outletId: session.outletId, frequency, status: "DRAFT" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!count) {
    count = await prisma.stockCount.create({
      data: {
        outletId: session.outletId,
        countedById: session.id,
        frequency,
        status: "DRAFT",
      },
      select: { id: true },
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
  const now = new Date();
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
