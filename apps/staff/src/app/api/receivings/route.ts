import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getUserFromHeaders } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const offset = Number(searchParams.get("offset")) || 0;
  const outletId = searchParams.get("outletId");

  const where = outletId ? { outletId } : {};

  const [receivings, total] = await Promise.all([
    prisma.receiving.findMany({
      where,
      select: {
        id: true,
        orderId: true,
        status: true,
        notes: true,
        invoicePhotos: true,
        receivedAt: true,
        order: { select: { orderNumber: true } },
        outlet: { select: { name: true } },
        supplier: { select: { name: true } },
        receivedBy: { select: { name: true } },
        items: {
          select: {
            id: true,
            orderedQty: true,
            receivedQty: true,
            expiryDate: true,
            discrepancyReason: true,
            product: { select: { name: true, sku: true } },
            productPackage: { select: { packageLabel: true } },
          },
        },
      },
      orderBy: { receivedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.receiving.count({ where }),
  ]);

  const mapped = receivings.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    orderNumber: r.order?.orderNumber ?? "Ad-hoc",
    outlet: r.outlet.name,
    supplier: r.supplier.name,
    receivedBy: r.receivedBy.name,
    receivedAt: r.receivedAt.toISOString(),
    status: r.status,
    notes: r.notes,
    photoCount: r.invoicePhotos.length,
    items: r.items.map((i) => ({
      id: i.id,
      product: i.product.name,
      sku: i.product.sku,
      package: i.productPackage?.packageLabel ?? "",
      orderedQty: i.orderedQty ? Number(i.orderedQty) : null,
      receivedQty: Number(i.receivedQty),
      expiryDate: i.expiryDate?.toISOString().split("T")[0] ?? null,
      discrepancyReason: i.discrepancyReason,
    })),
  }));

  return NextResponse.json({ data: mapped, total, limit, offset });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orderId, outletId, supplierId, items, notes, status, invoicePhotos } = body;

  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let receivingStatus = status || "COMPLETE";
  if (orderId) {
    const hasShort = items.some(
      (i: { orderedQty?: number; receivedQty: number }) =>
        i.orderedQty !== undefined && i.receivedQty < i.orderedQty,
    );
    if (hasShort) receivingStatus = "PARTIAL";
  }

  const receiving = await prisma.receiving.create({
    data: {
      orderId: orderId || null,
      outletId,
      supplierId,
      receivedById: caller.id,
      status: receivingStatus,
      notes: notes || null,
      invoicePhotos: invoicePhotos || [],
      items: {
        create: items.map((i: { productId: string; productPackageId?: string; orderedQty?: number; receivedQty: number; expiryDate?: string; discrepancyReason?: string }) => ({
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          orderedQty: i.orderedQty ?? null,
          receivedQty: i.receivedQty,
          expiryDate: i.expiryDate ? new Date(i.expiryDate) : null,
          discrepancyReason: i.discrepancyReason || null,
        })),
      },
    },
  });

  // Update stock balances (parallel)
  await Promise.all(
    items.map((item: { productId: string; receivedQty: number }) =>
      adjustStockBalance(outletId, item.productId, item.receivedQty),
    ),
  );

  // Update order status if linked
  if (orderId) {
    const allReceivings = await prisma.receiving.findMany({
      where: { orderId },
      select: { items: { select: { receivedQty: true } } },
    });
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { items: { select: { quantity: true } } },
    });
    if (order) {
      const totalOrdered = order.items.reduce((s, i) => s + Number(i.quantity), 0);
      const totalReceived = allReceivings.flatMap((r) => r.items).reduce((s, i) => s + Number(i.receivedQty), 0);
      const newStatus = totalReceived >= totalOrdered ? "COMPLETED" : "PARTIALLY_RECEIVED";
      await prisma.order.update({ where: { id: orderId }, data: { status: newStatus } });
    }
  }

  // Auto-create invoice from receiving
  try {
    const invCount = await prisma.invoice.count();
    const invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
    const totalAmount = orderId
      ? (await prisma.order.findUnique({ where: { id: orderId }, select: { totalAmount: true } }))?.totalAmount ?? 0
      : items.reduce((s: number, i: { receivedQty: number; unitPrice?: number }) => s + (i.receivedQty * (i.unitPrice ?? 0)), 0);

    await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: orderId || null,
        outletId,
        supplierId,
        amount: totalAmount,
        status: "PENDING",
        photos: invoicePhotos || [],
        notes: notes ? `From receiving: ${notes}` : null,
      },
    });
  } catch {
    // Invoice creation is non-critical — don't fail the receiving
  }

  await logActivity({
    userId: caller.id,
    action: "receive",
    module: "receivings",
    targetId: receiving.id,
    details: `Received ${items.length} items${orderId ? ` for order` : " (ad-hoc)"}`,
  });

  return NextResponse.json(receiving, { status: 201 });
}
