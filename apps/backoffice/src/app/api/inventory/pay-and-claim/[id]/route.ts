import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { adjustStockBalance } from "@/lib/stock";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { action, items, supplierId, amount, notes, claimedById, purchaseDate, invoiceNumber } = body;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      invoices: { take: 1 },
      outlet: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // ── Reject ──────────────────────────────────────────────────────────────
  if (action === "reject") {
    // Delete invoice(s), items, then order
    await prisma.invoice.deleteMany({ where: { orderId: id } });
    await prisma.orderItem.deleteMany({ where: { orderId: id } });
    await prisma.order.delete({ where: { id } });

    return NextResponse.json({ success: true, action: "rejected" });
  }

  // ── Save Draft ──────────────────────────────────────────────────────────
  if (action === "save") {
    const updateData: Record<string, unknown> = {};
    if (supplierId) updateData.supplierId = supplierId;
    if (notes !== undefined) updateData.notes = notes;
    if (purchaseDate) updateData.deliveryDate = new Date(purchaseDate);
    if (claimedById) updateData.claimedById = claimedById;

    // Recalculate total if items provided
    if (items?.length) {
      const totalAmount = items.reduce(
        (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
        0,
      );
      updateData.totalAmount = totalAmount;

      // Replace items
      await prisma.orderItem.deleteMany({ where: { orderId: id } });
      await prisma.orderItem.createMany({
        data: items.map((i: { productId: string; productPackageId?: string; quantity: number; unitPrice: number }) => ({
          orderId: id,
          productId: i.productId,
          productPackageId: i.productPackageId || null,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          totalPrice: i.quantity * i.unitPrice,
        })),
      });
    } else if (amount !== undefined) {
      updateData.totalAmount = amount;
    }

    await prisma.order.update({ where: { id }, data: updateData });

    // Update invoice if exists
    if (order.invoices[0]) {
      const invUpdate: Record<string, unknown> = {};
      if (supplierId) invUpdate.supplierId = supplierId;
      if (notes !== undefined) invUpdate.notes = notes;
      if (amount !== undefined) invUpdate.amount = amount;
      if (invoiceNumber) invUpdate.invoiceNumber = invoiceNumber;
      if (Object.keys(invUpdate).length > 0) {
        await prisma.invoice.update({ where: { id: order.invoices[0].id }, data: invUpdate });
      }
    }

    return NextResponse.json({ success: true, action: "saved" });
  }

  // ── Approve ─────────────────────────────────────────────────────────────
  if (action === "approve") {
    if (!items?.length) {
      return NextResponse.json({ error: "Items are required for approval" }, { status: 400 });
    }

    const finalSupplierId = supplierId || order.supplierId;
    const totalAmount = items.reduce(
      (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
      0,
    );

    // Update order to COMPLETED
    await prisma.orderItem.deleteMany({ where: { orderId: id } });
    await prisma.order.update({
      where: { id },
      data: {
        status: "COMPLETED",
        supplierId: finalSupplierId,
        totalAmount,
        notes: notes ?? order.notes,
        deliveryDate: purchaseDate ? new Date(purchaseDate) : order.deliveryDate,
        claimedById: claimedById || order.claimedById,
        items: {
          create: items.map((i: { productId: string; productPackageId?: string; quantity: number; unitPrice: number }) => ({
            productId: i.productId,
            productPackageId: i.productPackageId || null,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.quantity * i.unitPrice,
          })),
        },
      },
    });

    // Create receiving record
    await prisma.receiving.create({
      data: {
        orderId: id,
        outletId: order.outletId,
        supplierId: finalSupplierId,
        receivedById: caller.id,
        status: "COMPLETE",
        notes: notes ? `Pay & Claim approved: ${notes}` : "Pay & Claim approved",
        invoicePhotos: order.invoices[0]?.photos ?? [],
        items: {
          create: items.map((i: { productId: string; productPackageId?: string; quantity: number }) => ({
            productId: i.productId,
            productPackageId: i.productPackageId || null,
            orderedQty: i.quantity,
            receivedQty: i.quantity,
          })),
        },
      },
    });

    // Adjust stock
    await Promise.all(
      items.map((item: { productId: string; quantity: number }) =>
        adjustStockBalance(order.outletId, item.productId, item.quantity),
      ),
    );

    // Update invoice to PENDING
    if (order.invoices[0]) {
      await prisma.invoice.update({
        where: { id: order.invoices[0].id },
        data: {
          status: "PENDING",
          amount: totalAmount,
          supplierId: finalSupplierId,
          notes: notes ? `Staff claim approved: ${notes}` : "Staff claim approved",
        },
      });
    } else {
      // Create invoice if none exists
      const invCount = await prisma.invoice.count();
      const invNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
      await prisma.invoice.create({
        data: {
          invoiceNumber: invNumber,
          orderId: id,
          outletId: order.outletId,
          supplierId: finalSupplierId,
          amount: totalAmount,
          status: "PENDING",
          paymentType: "STAFF_CLAIM",
          claimedById: claimedById || order.claimedById,
          photos: [],
          notes: notes ? `Staff claim approved: ${notes}` : "Staff claim approved",
        },
      });
    }

    return NextResponse.json({ success: true, action: "approved" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
