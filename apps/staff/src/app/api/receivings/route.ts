import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";

export async function GET(req: NextRequest) {
  const session = await getSession();
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const offset = Number(searchParams.get("offset")) || 0;
  const outletId = searchParams.get("outletId") || session?.outletId || null;

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
    supplier: r.supplier?.name ?? "Unknown",
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

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Staff/managers may only record receivings for their own outlet.
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (!isAdmin && outletId !== session.outletId) {
    return NextResponse.json({ error: "Cannot record receiving for another outlet" }, { status: 403 });
  }

  let receivingStatus = status || "COMPLETE";
  if (orderId) {
    // Receivable from SENT onwards — procurement must have transmitted the PO
    // to the supplier before goods would be in transit. Credit-term suppliers
    // can still deliver days/weeks before the invoice arrives, so we don't
    // require an attached invoice at receive time.
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    const RECEIVABLE = ["SENT", "AWAITING_DELIVERY", "PARTIALLY_RECEIVED"];
    if (order && !RECEIVABLE.includes(order.status)) {
      const msg =
        order.status === "COMPLETED" ? "Order already fully received." :
        order.status === "CANCELLED" ? "Order was cancelled and cannot be received." :
        "PO must be Sent to the supplier before goods can be received. Ask procurement to send it first.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

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
      receivedById: session.id,
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

  // PO reconciliation: hard-overwrite each PO line to reflect cumulative
  // receivedQty so the PO total matches what the supplier should bill us.
  // Discrepancy is preserved on receiving rows (orderedQty vs receivedQty).
  if (orderId) {
    const allReceivings = await prisma.receiving.findMany({
      where: { orderId },
      select: {
        items: {
          select: { productId: true, productPackageId: true, receivedQty: true },
        },
      },
    });
    const cumulativeByLine = new Map<string, number>();
    for (const r of allReceivings) {
      for (const it of r.items) {
        const key = `${it.productId}::${it.productPackageId ?? ""}`;
        cumulativeByLine.set(key, (cumulativeByLine.get(key) ?? 0) + Number(it.receivedQty));
      }
    }

    const orderItems = await prisma.orderItem.findMany({
      where: { orderId },
      select: { id: true, productId: true, productPackageId: true, unitPrice: true, quantity: true },
    });

    let newTotalAmount = 0;
    for (const oi of orderItems) {
      const key = `${oi.productId}::${oi.productPackageId ?? ""}`;
      const cumReceived = cumulativeByLine.get(key);
      const newQty = cumReceived ?? Number(oi.quantity);
      const lineTotal = newQty * Number(oi.unitPrice);
      newTotalAmount += lineTotal;
      if (cumReceived !== undefined && cumReceived !== Number(oi.quantity)) {
        await prisma.orderItem.update({
          where: { id: oi.id },
          data: { quantity: cumReceived, totalPrice: lineTotal },
        });
      }
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { totalAmount: newTotalAmount, status: "COMPLETED" },
    });

    // Placeholder invoice (GRNI). Staff app needs this so the supplier
    // invoice can be attached later via backoffice. If a placeholder
    // already exists for this order, update its amount to match the
    // freshly-overwritten PO total. Don't touch a real (non-placeholder)
    // invoice — finance owns those.
    try {
      const existing = await prisma.invoice.findFirst({
        where: { orderId },
        orderBy: { createdAt: "desc" },
        select: { id: true, invoiceNumber: true, dueDate: true, status: true },
      });

      if (existing) {
        const isPlaceholder =
          existing.invoiceNumber.startsWith("INV-") &&
          existing.dueDate == null &&
          existing.status === "PENDING";
        const updateData: Record<string, unknown> = {};
        if (invoicePhotos && invoicePhotos.length > 0) {
          updateData.photos = { push: invoicePhotos };
        }
        if (isPlaceholder) updateData.amount = newTotalAmount;
        if (Object.keys(updateData).length > 0) {
          await prisma.invoice.update({ where: { id: existing.id }, data: updateData });
        }
      } else if (supplierId) {
        const invCount = await prisma.invoice.count();
        const invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
        await prisma.invoice.create({
          data: {
            invoiceNumber,
            orderId,
            outletId,
            supplierId,
            amount: newTotalAmount,
            status: "PENDING",
            photos: invoicePhotos || [],
            notes: notes ? `From receiving: ${notes}` : null,
          },
        });
      }
    } catch (err) {
      console.error("[staff receivings] placeholder invoice attach/create failed:", err);
    }
  }

  await logActivity({
    userId: session.id,
    action: "receive",
    module: "receivings",
    targetId: receiving.id,
    details: `Received ${items.length} items${orderId ? ` for order` : " (ad-hoc)"}`,
  });

  return NextResponse.json(receiving, { status: 201 });
}
