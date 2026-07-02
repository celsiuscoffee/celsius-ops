/**
 * Proactive ordering (Inc 3) — the exec opens a DRAFT PO for a below-reorder item
 * to the CHEAPEST sound supplier BEFORE stock runs out, so the buyer just reviews +
 * sends. DRAFT only (no send / no payment / no stock move), idempotent, and CAPPED
 * via boundedReorderQty (MOQ floor; max-level + shelf-life ceilings — so it never
 * overpurchases). Mirrors resource-po.ts but targets the cheapest source, not an
 * alternative. Used by the exec controller when PROCUREMENT_EXEC_AUTO_ORDER=true.
 */
import { prisma } from "@/lib/prisma";
import { boundedReorderQty } from "@/lib/inventory/order-validation";
import { nextOrderNumber } from "@/lib/inventory/order-number";

export const PROACTIVE_NOTE_PREFIX = "Auto reorder by procurement exec";

export async function createReorderDraftPO(opts: {
  productId: string;
  productName: string;
  neededBase: number; // par − (stock + on-order), base units
  headroomBase?: number | null; // maxLevel − stock − on-order (base) — overstock cap
  shelfUsableBase?: number | null; // shelfLifeDays × avgDailyUsage (base) — spoilage cap
  outletId: string;
  systemUserId: string;
}): Promise<{ orderId: string; orderNumber: string; supplierName: string; qty: number; existing: boolean } | null> {
  if (opts.neededBase <= 0) return null;

  const sps = await prisma.supplierProduct.findMany({
    where: { productId: opts.productId, isActive: true, price: { gt: 0 }, supplier: { status: "ACTIVE" } },
    select: {
      price: true,
      moq: true,
      productPackageId: true,
      supplier: { select: { id: true, name: true } },
      productPackage: { select: { conversionFactor: true } },
    },
  });
  if (!sps.length) return null;

  const best = sps
    .map((a) => {
      const conv = a.productPackage ? Number(a.productPackage.conversionFactor) : 1;
      return { a, conv: conv > 0 ? conv : 1, unitCost: Number(a.price) / (conv > 0 ? conv : 1) };
    })
    .sort((x, y) => x.unitCost - y.unitCost)[0];
  const supplierId = best.a.supplier.id;

  // Idempotency: a DRAFT exec-reorder for this supplier+outlet already covering it.
  const existing = await prisma.order.findFirst({
    where: {
      supplierId,
      outletId: opts.outletId,
      orderType: "PURCHASE_ORDER",
      status: "DRAFT",
      notes: { startsWith: PROACTIVE_NOTE_PREFIX },
      items: { some: { productId: opts.productId } },
    },
    select: { id: true, orderNumber: true },
  });
  if (existing) {
    return { orderId: existing.id, orderNumber: existing.orderNumber, supplierName: best.a.supplier.name, qty: 0, existing: true };
  }

  const { orderQty } = boundedReorderQty({
    neededBase: opts.neededBase,
    conversionFactor: best.conv,
    moq: Number(best.a.moq) || 0,
    headroomBase: opts.headroomBase ?? null,
    shelfUsableBase: opts.shelfUsableBase ?? null,
  });
  if (orderQty <= 0) return null;

  const unitPrice = Number(best.a.price);
  try {
    const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: opts.outletId }, select: { code: true } });
    // Max-suffix helper, NOT COUNT(*)+1 — a count drifts behind the real max the moment a
    // row is deleted or another scheme numbers ahead, and then every daily exec run
    // collides on the @unique orderNumber and silently creates nothing (the count never
    // advances past the collision). See order-number.ts — this exact bug was live once.
    const orderNumber = await nextOrderNumber(outlet.code);
    const order = await prisma.order.create({
      data: {
        orderNumber,
        orderType: "PURCHASE_ORDER",
        outletId: opts.outletId,
        supplierId,
        status: "DRAFT",
        totalAmount: Math.round(orderQty * unitPrice * 100) / 100,
        notes: `${PROACTIVE_NOTE_PREFIX}: ${opts.productName} below reorder point. Review + send.`,
        createdById: opts.systemUserId,
        items: {
          create: [
            {
              productId: opts.productId,
              productPackageId: best.a.productPackageId || null,
              quantity: orderQty,
              unitPrice,
              totalPrice: Math.round(orderQty * unitPrice * 100) / 100,
            },
          ],
        },
      },
      select: { id: true, orderNumber: true },
    });
    return { orderId: order.id, orderNumber: order.orderNumber, supplierName: best.a.supplier.name, qty: orderQty, existing: false };
  } catch (e) {
    console.warn("[exec] reorder PO create failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
