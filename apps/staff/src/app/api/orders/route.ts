import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { checkModuleAccess } from "@/lib/check-module-access";
import { logActivity } from "@/lib/activity-log";

export async function GET(req: NextRequest) {
  // Staff with `inventory:receivings` need to read the pending PO list to
  // receive against — the Receive & Capture screen ("Expected Today")
  // calls this endpoint. Gating GET on `inventory:orders` alone locked
  // out every line-staff receiver (only managers/owners hold that key).
  // Mutations below stay gated to `inventory:orders`.
  const guard = await checkModuleAccess(req, [
    "inventory:orders",
    "inventory:receivings",
  ]);
  if (!guard.ok) return guard.response;
  const session = guard.session;
  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const status = url.searchParams.get("status") ?? "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50")));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  // Staff only see orders for their outlet
  const outletId = url.searchParams.get("outletId") || session?.outletId;
  if (outletId) {
    where.outletId = outletId;
  }
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: "insensitive" } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
    ];
  }
  if (status) {
    where.status = status;
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        notes: true,
        deliveryDate: true,
        sentAt: true,
        approvedAt: true,
        createdAt: true,
        outlet: { select: { name: true, code: true } },
        supplier: { select: { id: true, name: true, phone: true } },
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
        items: {
          select: {
            id: true,
            productId: true,
            productPackageId: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            notes: true,
            product: { select: { name: true, sku: true, shelfLifeDays: true, baseUom: true } },
            productPackage: { select: { packageLabel: true, packageName: true } },
          },
        },
        _count: { select: { receivings: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  // Balance-receiving context. Each receiving OVERWRITES OrderItem.quantity to
  // the cumulative received, so on a partially-received PO `quantity` no longer
  // holds the original order — the receive screens need the original target and
  // the running total to prefill the REMAINING balance (prefolding `quantity`
  // invites double-receipt: confirm-the-prefill records the already-received
  // amount again). Original ordered = MAX of the per-receiving orderedQty
  // snapshots (the first receiving saw the pre-overwrite PO); received-so-far =
  // sum of receivedQty across receivings, keyed per product+package line.
  const withReceipts = orders.filter((o) => o._count.receivings > 0).map((o) => o.id);
  const cumByOrder = new Map<string, Map<string, { received: number; ordered: number }>>();
  if (withReceipts.length > 0) {
    const recvItems = await prisma.receivingItem.findMany({
      where: { receiving: { orderId: { in: withReceipts } } },
      select: {
        productId: true,
        productPackageId: true,
        receivedQty: true,
        orderedQty: true,
        receiving: { select: { orderId: true } },
      },
    });
    for (const ri of recvItems) {
      const orderId = ri.receiving.orderId;
      if (!orderId) continue;
      const key = `${ri.productId}::${ri.productPackageId ?? ""}`;
      const byLine = cumByOrder.get(orderId) ?? new Map();
      const cur = byLine.get(key) ?? { received: 0, ordered: 0 };
      cur.received += Number(ri.receivedQty);
      if (ri.orderedQty != null) cur.ordered = Math.max(cur.ordered, Number(ri.orderedQty));
      byLine.set(key, cur);
      cumByOrder.set(orderId, byLine);
    }
  }

  const mapped = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    outlet: o.outlet.name,
    outletCode: o.outlet.code,
    supplierId: o.supplier?.id ?? "",
    supplier: o.supplier?.name ?? "Unknown",
    supplierPhone: o.supplier?.phone ?? "",
    status: o.status,
    totalAmount: Number(o.totalAmount),
    notes: o.notes,
    deliveryDate: o.deliveryDate?.toISOString().split("T")[0] ?? null,
    createdBy: o.createdBy.name,
    approvedBy: o.approvedBy?.name ?? null,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    sentAt: o.sentAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((i) => {
      const line = cumByOrder.get(o.id)?.get(`${i.productId}::${i.productPackageId ?? ""}`);
      const receivedSoFar = line?.received ?? 0;
      // No snapshot (line never touched by a receiving) → quantity still holds
      // the original order.
      const orderedOriginal = line && line.ordered > 0 ? line.ordered : Number(i.quantity);
      return {
        id: i.id,
        productId: i.productId,
        product: i.product.name,
        sku: i.product.sku,
        uom: i.productPackage?.packageLabel ?? i.product.baseUom,
        shelfLifeDays: i.product.shelfLifeDays,
        package: i.productPackage?.packageLabel ?? i.productPackage?.packageName ?? "",
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        totalPrice: Number(i.totalPrice),
        notes: i.notes,
        orderedOriginalQty: orderedOriginal,
        receivedSoFarQty: receivedSoFar,
        remainingQty: Math.max(0, orderedOriginal - receivedSoFar),
      };
    }),
    receivingCount: o._count.receivings,
  }));

  return NextResponse.json({ items: mapped, total, page, limit });
}

export async function POST(req: NextRequest) {
  // Module gate before parsing body — fails fast for unauthorized callers.
  const guard = await checkModuleAccess(req, "inventory:orders");
  if (!guard.ok) return guard.response;
  const caller = guard.session;

  const body = await req.json();
  const { outletId, supplierId, items, notes, deliveryDate } = body;

  const outlet = await prisma.outlet.findUniqueOrThrow({ where: { id: outletId } });
  const count = await prisma.order.count({ where: { outletId } });
  const orderNumber = `CC-${outlet.code}-${String(count + 1).padStart(4, "0")}`;

  const totalAmount = items.reduce(
    (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
    0,
  );

  const order = await prisma.order.create({
    data: {
      orderNumber,
      outletId,
      supplierId,
      status: "DRAFT",
      totalAmount,
      notes: notes || null,
      deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
      createdById: caller.id,
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; quantity: number; unitPrice: number; notes?: string }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          totalPrice: i.quantity * i.unitPrice,
          notes: i.notes || null,
        })),
      },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      outlet: { select: { name: true } },
      supplier: { select: { name: true } },
      items: {
        select: {
          product: { select: { name: true } },
          productPackage: { select: { packageLabel: true } },
          quantity: true,
          unitPrice: true,
          totalPrice: true,
        },
      },
    },
  });

  await logActivity({
    userId: caller.id,
    action: "create",
    module: "orders",
    targetId: order.id,
    targetName: order.orderNumber,
    details: `Created order for ${order.supplier?.name ?? "Unknown"} (${order.items.length} items, RM${Number(order.totalAmount).toFixed(2)})`,
  });

  return NextResponse.json(order, { status: 201 });
}
