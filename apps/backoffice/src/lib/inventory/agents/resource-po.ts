import { prisma } from "@/lib/prisma";
import { boundedReorderQty } from "@/lib/inventory/order-validation";

// When the supplier-chat agent removes a line because the supplier is out of
// stock, the need would otherwise vanish (stockout risk). createReSourcePO opens
// a DRAFT purchase order to the next-cheapest alternative supplier for that
// product, so procurement just reviews + sends it.
//
// SAFE: DRAFT only — never sent, no payment, no stock move. Internal: the
// alternative supplier is NEVER surfaced to the supplier we're chatting with.
// Idempotent: won't duplicate a pending re-source for the same product+supplier.

export type ReSourceResult = {
  orderId: string; // the draft PO's id (for deep-linking from the chat)
  supplierName: string;
  orderNumber: string;
  qty: number; // alternative-supplier package units
  unit: string;
  existing: boolean; // true if an existing draft re-source already covered it
};

const RESOURCE_NOTE_PREFIX = "Auto re-source by supplier-chat agent";

export async function createReSourcePO(opts: {
  productId: string;
  productName: string;
  baseQtyNeeded: number; // base units to re-source (the removed line's qty)
  fromSupplierId: string; // the OOS supplier — excluded + never named to them
  fromSupplierName: string;
  outletId: string;
  systemUserId: string;
}): Promise<ReSourceResult | null> {
  if (opts.baseQtyNeeded <= 0) return null;

  // Alternative active suppliers carrying this product (exclude the OOS one).
  const alts = await prisma.supplierProduct.findMany({
    where: {
      productId: opts.productId,
      isActive: true,
      price: { gt: 0 },
      supplierId: { not: opts.fromSupplierId },
      supplier: { status: "ACTIVE" },
    },
    select: {
      price: true,
      moq: true,
      productPackageId: true,
      supplier: { select: { id: true, name: true } },
      productPackage: { select: { conversionFactor: true, packageLabel: true } },
    },
  });
  if (alts.length === 0) return null;

  // Cheapest per base unit.
  const ranked = alts
    .map((a) => {
      const conv = a.productPackage ? Number(a.productPackage.conversionFactor) : 1;
      return { a, conv: conv > 0 ? conv : 1, unitCost: Number(a.price) / (conv > 0 ? conv : 1) };
    })
    .sort((x, y) => x.unitCost - y.unitCost);
  const best = ranked[0];
  const altSupplierId = best.a.supplier.id;

  const { orderQty } = boundedReorderQty({
    neededBase: opts.baseQtyNeeded,
    conversionFactor: best.conv,
    moq: Number(best.a.moq) || 0,
  });
  const unitPrice = Number(best.a.price);
  const unit = best.a.productPackage?.packageLabel ?? "unit";

  // Idempotency: a pending (DRAFT) re-source for this supplier+outlet that
  // already includes this product → don't open a second.
  const existing = await prisma.order.findFirst({
    where: {
      supplierId: altSupplierId,
      outletId: opts.outletId,
      orderType: "PURCHASE_ORDER",
      status: "DRAFT",
      notes: { startsWith: RESOURCE_NOTE_PREFIX },
      items: { some: { productId: opts.productId } },
    },
    select: { id: true, orderNumber: true },
  });
  if (existing) {
    return { orderId: existing.id, supplierName: best.a.supplier.name, orderNumber: existing.orderNumber, qty: orderQty, unit, existing: true };
  }

  try {
    const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: opts.outletId }, select: { code: true } });
    const count = await prisma.order.count({ where: { outletId: opts.outletId } });
    const orderNumber = `CC-${outlet.code}-${String(count + 1).padStart(4, "0")}`;
    const order = await prisma.order.create({
      data: {
        orderNumber,
        orderType: "PURCHASE_ORDER",
        outletId: opts.outletId,
        supplierId: altSupplierId,
        status: "DRAFT",
        totalAmount: Math.round(orderQty * unitPrice * 100) / 100,
        notes: `${RESOURCE_NOTE_PREFIX}: ${opts.productName} OOS at ${opts.fromSupplierName}. Review + send.`,
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
    return { orderId: order.id, supplierName: best.a.supplier.name, orderNumber: order.orderNumber, qty: orderQty, unit, existing: false };
  } catch (e) {
    console.warn("[resource-po] create failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
