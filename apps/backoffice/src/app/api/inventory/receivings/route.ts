import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET(req: NextRequest) {
  // Auto-reconcile: fix PO statuses where receivings exist but order is still "awaiting"
  try {
    const staleOrders = await prisma.order.findMany({
      where: { status: { in: ["SENT", "APPROVED", "AWAITING_DELIVERY"] } },
      select: { id: true, items: { select: { quantity: true } } },
    });
    for (const order of staleOrders) {
      const receivings = await prisma.receiving.findMany({
        where: { orderId: order.id },
        select: { items: { select: { receivedQty: true } } },
      });
      if (receivings.length === 0) continue;
      const totalOrdered = order.items.reduce((s, i) => s + Number(i.quantity), 0);
      const totalReceived = receivings.flatMap((r) => r.items).reduce((s, i) => s + Number(i.receivedQty), 0);
      const newStatus = totalReceived >= totalOrdered ? "COMPLETED" : "PARTIALLY_RECEIVED";
      await prisma.order.update({ where: { id: order.id }, data: { status: newStatus } });
    }
  } catch (err) {
    console.error("[receivings] Auto-reconcile failed:", err);
  }

  const tab = req.nextUrl.searchParams.get("tab") || "recent";
  const search = req.nextUrl.searchParams.get("search") || "";

  const orderId = req.nextUrl.searchParams.get("orderId") || "";

  const where: Record<string, unknown> = {};
  if (orderId) {
    where.orderId = orderId;
  } else if (tab === "recent") {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    where.receivedAt = { gte: thirtyDaysAgo };
  }

  if (search) {
    where.OR = [
      { order: { orderNumber: { contains: search, mode: "insensitive" } } },
      { supplier: { name: { contains: search, mode: "insensitive" } } },
      { outlet: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const receivings = await prisma.receiving.findMany({
    where,
    take: 100,
    select: {
      id: true,
      orderId: true,
      transferId: true,
      status: true,
      notes: true,
      invoicePhotos: true,
      receivedAt: true,
      order: { select: { orderNumber: true } },
      transfer: { select: { fromOutlet: { select: { name: true } } } },
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
  });

  const mapped = receivings.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    transferId: r.transferId,
    orderNumber: r.order?.orderNumber ?? (r.transferId ? "Transfer" : "Ad-hoc"),
    outlet: r.outlet.name,
    supplier: r.supplier?.name ?? r.transfer?.fromOutlet?.name ?? "Transfer",
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

  return NextResponse.json(mapped);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orderId, transferId, outletId, supplierId, items, notes, status, invoicePhotos } = body;

  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isTransfer = !!transferId;

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
      transferId: transferId || null,
      outletId,
      supplierId: supplierId || null,
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

  // Update stock balances (parallel) — track per package
  await Promise.all(
    items.map((item: { productId: string; productPackageId?: string; receivedQty: number }) =>
      adjustStockBalance(outletId, item.productId, item.receivedQty, item.productPackageId),
    ),
  );

  // Update order status if linked to a PO
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

  // Update transfer status to RECEIVED if linked to a transfer
  if (isTransfer) {
    await prisma.stockTransfer.update({
      where: { id: transferId },
      data: {
        status: "RECEIVED",
        receivedById: caller.id,
        receivedAt: new Date(),
        completedAt: new Date(),
      },
    });
  }

  // Auto-create invoice from receiving (skip for transfers — no supplier invoice)
  if (!isTransfer) {
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
          supplierId: supplierId!,
          amount: totalAmount,
          status: "PENDING",
          photos: invoicePhotos || [],
          notes: notes ? `From receiving: ${notes}` : null,
        },
      });
    } catch {
      // Invoice creation is non-critical — don't fail the receiving
    }
  }

  return NextResponse.json(receiving, { status: 201 });
}
