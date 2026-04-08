import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProducts } from "@/lib/storehub";
import { getUserFromHeaders } from "@/lib/auth";

/**
 * POST /api/storehub/sync-products
 *
 * Pull product catalog from StoreHub and upsert into Menu table.
 * Creates new menu items, updates existing ones (name, category, price).
 * Never deletes — only deactivates items no longer in StoreHub.
 */
export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller || (caller.role !== "ADMIN" && caller.role !== "OWNER")) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let shProducts;
  try {
    shProducts = await getProducts();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `StoreHub API error: ${message}` }, { status: 502 });
  }

  if (!shProducts || shProducts.length === 0) {
    return NextResponse.json({ error: "No products returned from StoreHub" }, { status: 422 });
  }

  // Get existing menus
  const existingMenus = await prisma.menu.findMany({
    select: { id: true, storehubId: true, name: true, category: true, sellingPrice: true },
  });
  const existingMap = new Map(existingMenus.map((m) => [m.storehubId, m]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let deactivated = 0;

  const seenStorehubIds = new Set<string>();

  for (const sp of shProducts) {
    if (!sp.id) continue;
    seenStorehubIds.add(sp.id);

    const existing = existingMap.get(sp.id);
    const category = sp.category || null;
    const price = sp.unitPrice ?? null;

    if (existing) {
      // Check if anything changed
      const nameChanged = existing.name !== sp.name;
      const categoryChanged = existing.category !== category;
      const priceChanged = price !== null && Number(existing.sellingPrice) !== price;

      if (nameChanged || categoryChanged || priceChanged) {
        await prisma.menu.update({
          where: { id: existing.id },
          data: {
            name: sp.name,
            category,
            sellingPrice: price,
            isActive: true,
            lastSyncedAt: new Date(),
          },
        });
        updated++;
      } else {
        // Touch lastSyncedAt even if no changes
        await prisma.menu.update({
          where: { id: existing.id },
          data: { isActive: true, lastSyncedAt: new Date() },
        });
        unchanged++;
      }
    } else {
      // Create new menu item
      await prisma.menu.create({
        data: {
          name: sp.name,
          storehubId: sp.id,
          category,
          sellingPrice: price,
          isActive: true,
          lastSyncedAt: new Date(),
        },
      });
      created++;
    }
  }

  // Deactivate menus not in StoreHub anymore
  const toDeactivate = existingMenus.filter(
    (m) => !seenStorehubIds.has(m.storehubId) && m.storehubId,
  );
  if (toDeactivate.length > 0) {
    await prisma.menu.updateMany({
      where: { id: { in: toDeactivate.map((m) => m.id) } },
      data: { isActive: false },
    });
    deactivated = toDeactivate.length;
  }

  // Record sync
  await prisma.storehubSync.create({
    data: {
      outletId: (await prisma.outlet.findFirst({ select: { id: true } }))!.id,
      syncType: "PRODUCTS",
      status: "SUCCESS",
      lastSyncAt: new Date(),
      recordCount: shProducts.length,
    },
  });

  return NextResponse.json({
    success: true,
    total: shProducts.length,
    created,
    updated,
    unchanged,
    deactivated,
  });
}
