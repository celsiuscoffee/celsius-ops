import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTransactions, getProducts } from "@/lib/storehub";

/**
 * POST /api/storehub/sync-sales
 *
 * Pull sales transactions from StoreHub for a branch and date range,
 * then upsert into SalesTransaction table.
 *
 * Body: { branchId, from?, to?, days? }
 *  - from/to: "YYYY-MM-DD" date range (default: last 30 days)
 *  - days: shortcut — sync last N days (overrides from/to)
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { branchId, days } = body;

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  // Get branch with storehubId
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) {
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  }
  if (!branch.storehubId) {
    return NextResponse.json(
      { error: `Branch "${branch.name}" has no storehubId configured` },
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
    transactions = await getTransactions(branch.storehubId, from, to);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.storehubSync.create({
      data: {
        branchId,
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

  for (const txn of transactions) {
    for (const item of txn.items) {
      // Transaction items have productId but no name — look up from catalog
      const itemName = shProductNames.get(item.productId || "") || "Unknown";
      const itemIndex = txn.items.indexOf(item);
      const txId = `${txn.refId}-${itemIndex}`;

      // Match to our Menu by storehubId (productId from StoreHub)
      const menu = item.productId ? menuByStorehubId.get(item.productId) : null;

      if (!menu) {
        if (!unmatched.includes(itemName)) {
          unmatched.push(itemName);
        }
        skipped++;
        continue;
      }

      // Use transactionTime from StoreHub
      const transactedAt = txn.transactionTime || txn.completedAt || txn.createdAt;
      if (!transactedAt) {
        skipped++;
        continue;
      }

      try {
        await prisma.salesTransaction.upsert({
          where: { storehubTxId: txId },
          create: {
            storehubTxId: txId,
            branchId,
            menuId: menu.id,
            menuName: menu.name,
            quantity: item.quantity,
            grossAmount: item.total,
            transactedAt: new Date(transactedAt),
          },
          update: {
            quantity: item.quantity,
            grossAmount: item.total,
          },
        });
        created++;
      } catch {
        skipped++;
      }
    }
  }

  // Record successful sync
  await prisma.storehubSync.create({
    data: {
      branchId,
      syncType: "SALES",
      status: "SUCCESS",
      lastSyncAt: new Date(),
      recordCount: created,
    },
  });

  return NextResponse.json({
    success: true,
    branch: branch.name,
    dateRange: { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] },
    transactions: transactions.length,
    salesRecords: created,
    skipped,
    unmatchedMenuItems: unmatched,
  });
}
