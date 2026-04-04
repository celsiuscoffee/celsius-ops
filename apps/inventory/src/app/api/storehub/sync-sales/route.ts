import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTransactions, getProducts } from "@/lib/storehub";

/**
 * POST /api/storehub/sync-sales
 *
 * Pull sales transactions from StoreHub for an outlet and date range,
 * then upsert into SalesTransaction table.
 *
 * Body: { outletId, from?, to?, days? }
 *  - from/to: "YYYY-MM-DD" date range (default: last 30 days)
 *  - days: shortcut — sync last N days (overrides from/to)
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { outletId, days } = body;

  if (!outletId) {
    return NextResponse.json({ error: "outletId is required" }, { status: 400 });
  }

  // Get outlet with storehubId
  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
  if (!outlet) {
    return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
  }
  if (!outlet.storehubId) {
    return NextResponse.json(
      { error: `Outlet "${outlet.name}" has no storehubId configured` },
      { status: 422 },
    );
  }

  // Determine date range
  const to = body.to ? new Date(body.to) : new Date();
  let from: Date;
  if (days) {
    from = new Date();
    from.setDate(from.getDate() - Number(days));
  } else if (body.from) {
    from = new Date(body.from);
  } else {
    from = new Date();
    from.setDate(from.getDate() - 30);
  }

  // Load StoreHub product catalog for name lookups
  const shProducts = await getProducts();
  const shProductNames = new Map(shProducts.map((p) => [p.id, p.name]));

  // Load all menus to map StoreHub productId → our menu IDs
  const menus = await prisma.menu.findMany({
    where: { isActive: true },
    select: { id: true, name: true, storehubId: true },
  });

  const menuByStorehubId = new Map(menus.map((m) => [m.storehubId, m]));

  // Fetch from StoreHub API
  let transactions;
  try {
    transactions = await getTransactions(outlet.storehubId, from, to);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.storehubSync.create({
      data: {
        outletId,
        syncType: "SALES",
        status: "FAILED",
        lastSyncAt: new Date(),
        errorMessage: message,
      },
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Flatten transaction items into SalesTransaction records
  let created = 0;
  let skipped = 0;
  const unmatched: string[] = [];

  // Build batch of upsert operations
  type UpsertOp = { txId: string; menuId: string; menuName: string; quantity: number; total: number; transactedAt: Date };
  const ops: UpsertOp[] = [];

  for (const txn of transactions) {
    for (let itemIndex = 0; itemIndex < txn.items.length; itemIndex++) {
      const item = txn.items[itemIndex];
      const itemName = shProductNames.get(item.productId || "") || "Unknown";
      const txId = `${txn.refId}-${itemIndex}`;

      const menu = item.productId ? menuByStorehubId.get(item.productId) : null;

      if (!menu) {
        if (!unmatched.includes(itemName)) {
          unmatched.push(itemName);
        }
        skipped++;
        continue;
      }

      const transactedAt = txn.transactionTime || txn.completedAt || txn.createdAt;
      if (!transactedAt) {
        skipped++;
        continue;
      }

      ops.push({ txId, menuId: menu.id, menuName: menu.name, quantity: item.quantity, total: item.total, transactedAt: new Date(transactedAt) });
    }
  }

  // Execute upserts in parallel chunks of 50
  const CHUNK_SIZE = 50;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map((op) =>
        prisma.salesTransaction.upsert({
          where: { storehubTxId: op.txId },
          create: {
            storehubTxId: op.txId,
            outletId,
            menuId: op.menuId,
            menuName: op.menuName,
            quantity: op.quantity,
            grossAmount: op.total,
            transactedAt: op.transactedAt,
          },
          update: {
            quantity: op.quantity,
            grossAmount: op.total,
          },
        }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") created++;
      else skipped++;
    }
  }

  // Record successful sync
  await prisma.storehubSync.create({
    data: {
      outletId,
      syncType: "SALES",
      status: "SUCCESS",
      lastSyncAt: new Date(),
      recordCount: created,
    },
  });

  return NextResponse.json({
    success: true,
    outlet: outlet.name,
    dateRange: { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] },
    transactions: transactions.length,
    salesRecords: created,
    skipped,
    unmatchedMenuItems: unmatched,
  });
}
