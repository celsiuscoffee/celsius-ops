import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      outlet: true,
      supplier: true,
      items: { include: { product: true, productPackage: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { status, items, deliveryDate, invoiceDueDate, invoicePhotos } = body;
  const caller = await getUserFromHeaders(req.headers);

  const existing = await prisma.order.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};

  // ── Status transition ──
  if (status) {
    data.status = status;

    if (status === "APPROVED") {
      const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
      if (admin) {
        data.approvedById = admin.id;
        data.approvedAt = new Date();
      }
    }

    if (status === "SENT") {
      data.sentAt = new Date();
    }

    // Confirming a SENT order → AWAITING_DELIVERY
    if (status === "AWAITING_DELIVERY" && existing.status === "SENT") {
      data.confirmedAt = new Date();
    }
  }

  // ── Editable fields on SENT orders (adjustments after supplier response) ──
  if (deliveryDate !== undefined) {
    data.deliveryDate = deliveryDate ? new Date(deliveryDate) : null;
  }

  // ── Update order items (qty adjustments after supplier response) ──
  if (items && existing.status === "SENT") {
    // Delete existing items and recreate with adjusted quantities
    await prisma.orderItem.deleteMany({ where: { orderId: id } });
    await prisma.orderItem.createMany({
      data: items.map((i: { productId: string; productPackageId?: string; quantity: number; unitPrice: number; notes?: string }) => ({
        orderId: id,
        productId: i.productId,
        productPackageId: i.productPackageId || null,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPrice: i.quantity * i.unitPrice,
        notes: i.notes || null,
      })),
    });
    // Recalculate total
    data.totalAmount = items.reduce(
      (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
      0,
    );
  }

  // ── Auto-create/update invoice with due date and photos ──
  if ((invoiceDueDate !== undefined || invoicePhotos) && existing.status === "SENT") {
    const existingInvoice = await prisma.invoice.findFirst({ where: { orderId: id } });
    if (existingInvoice) {
      const invoiceUpdate: Record<string, unknown> = {};
      if (invoiceDueDate !== undefined) invoiceUpdate.dueDate = invoiceDueDate ? new Date(invoiceDueDate) : null;
      if (invoicePhotos) invoiceUpdate.photos = invoicePhotos;
      await prisma.invoice.update({ where: { id: existingInvoice.id }, data: invoiceUpdate });
    } else {
      // Create invoice from order
      const invCount = await prisma.invoice.count();
      const invoiceNumber = `INV-${String(invCount + 1).padStart(4, "0")}`;
      const order = await prisma.order.findUnique({
        where: { id },
        select: { totalAmount: true, outletId: true, supplierId: true },
      });
      if (order) {
        await prisma.invoice.create({
          data: {
            invoiceNumber,
            orderId: id,
            outletId: order.outletId,
            supplierId: order.supplierId,
            amount: order.totalAmount,
            status: "PENDING",
            dueDate: invoiceDueDate ? new Date(invoiceDueDate) : null,
            photos: invoicePhotos || [],
          },
        });
      }
    }
  }

  const order = await prisma.order.update({
    where: { id },
    data,
    select: { id: true, orderNumber: true, status: true },
  });

  if (caller) {
    const details: string[] = [];
    if (status) details.push(`Status → ${status}`);
    if (items) details.push(`${items.length} items adjusted`);
    if (deliveryDate !== undefined) details.push(`Delivery date updated`);
    if (invoiceDueDate !== undefined) details.push(`Invoice due date set`);
    if (invoicePhotos) details.push(`Invoice photo uploaded`);

    await logActivity({
      userId: caller.id,
      action: "update",
      module: "orders",
      targetId: order.id,
      targetName: order.orderNumber,
      details: details.join(", ") || `Order updated`,
    });
  }

  return NextResponse.json(order);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await getUserFromHeaders(req.headers);

  const order = await prisma.order.findUnique({ where: { id }, select: { status: true, orderNumber: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!["DRAFT", "CANCELLED"].includes(order.status)) {
    return NextResponse.json({ error: "Only draft or cancelled orders can be deleted" }, { status: 400 });
  }

  await prisma.orderItem.deleteMany({ where: { orderId: id } });
  await prisma.order.delete({ where: { id } });

  if (caller) {
    await logActivity({
      userId: caller.id,
      action: "delete",
      module: "orders",
      targetId: id,
      targetName: order.orderNumber,
      details: `Deleted ${order.status.toLowerCase()} order`,
    });
  }

  return NextResponse.json({ ok: true });
}
