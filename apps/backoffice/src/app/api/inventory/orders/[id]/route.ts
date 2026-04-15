import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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
  } catch (err) {
    console.error("[orders/[id] GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { status, totalAmount, deliveryDate, items, invoicePhotos } = body;

    const data: Record<string, unknown> = {};

    // Status transition
    if (status) {
      data.status = status;

      if (status === "APPROVED") {
        const caller = await getUserFromHeaders(req.headers);
        if (!caller) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        data.approvedById = caller.id;
        data.approvedAt = new Date();
      }

      if (status === "SENT") {
        data.sentAt = new Date();
      }
    }

    // Update delivery date
    if (deliveryDate !== undefined) {
      data.deliveryDate = deliveryDate ? new Date(deliveryDate) : null;
    }

    // Update individual items (quantity, unitPrice, or remove)
    if (items && Array.isArray(items)) {
      for (const item of items as { id: string; quantity?: number; unitPrice?: number; remove?: boolean }[]) {
        if (item.remove) {
          await prisma.orderItem.delete({ where: { id: item.id } });
        } else {
          const itemData: Record<string, unknown> = {};
          if (item.quantity !== undefined) itemData.quantity = item.quantity;
          if (item.unitPrice !== undefined) itemData.unitPrice = item.unitPrice;
          if (item.quantity !== undefined || item.unitPrice !== undefined) {
            // Recalculate totalPrice
            const existing = await prisma.orderItem.findUnique({ where: { id: item.id } });
            if (existing) {
              const qty = item.quantity ?? Number(existing.quantity);
              const price = item.unitPrice ?? Number(existing.unitPrice);
              itemData.totalPrice = qty * price;
            }
          }
          if (Object.keys(itemData).length > 0) {
            await prisma.orderItem.update({ where: { id: item.id }, data: itemData });
          }
        }
      }

      // Recalculate order total from remaining items
      const remaining = await prisma.orderItem.findMany({ where: { orderId: id } });
      data.totalAmount = remaining.reduce((sum, i) => sum + Number(i.totalPrice), 0);
    } else if (totalAmount !== undefined) {
      // Manual total override (only if no item edits)
      data.totalAmount = totalAmount;
    }

    const order = await prisma.order.update({
      where: { id },
      data,
      include: {
        outlet: true,
        supplier: true,
        items: { include: { product: true, productPackage: true } },
        invoices: true,
      },
    });

    // Auto-create invoice + receiving when order is confirmed (AWAITING_DELIVERY)
    if (status === "AWAITING_DELIVERY") {
      const caller = await getUserFromHeaders(req.headers);

      try {
        // Ensure invoice exists — saveEdit() usually creates it, but guard against edge cases
        const existingInvoice = await prisma.invoice.findFirst({ where: { orderId: id } });
        if (!existingInvoice) {
          const invCount = await prisma.invoice.count();
          await prisma.invoice.create({
            data: {
              invoiceNumber: `INV-${String(invCount + 1).padStart(4, "0")}`,
              orderId: id,
              outletId: order.outletId,
              supplierId: order.supplierId,
              amount: order.totalAmount,
              status: "PENDING",
              photos: invoicePhotos || [],
            },
          });
        }
      } catch (e) {
        console.error("[orders/[id] PATCH] Invoice auto-create failed:", e);
      }

      // Receiving is created by staff when they actually receive the delivery
      // — not auto-created on Confirm Order
    }

    return NextResponse.json(order);
  } catch (err) {
    console.error("[orders/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const order = await prisma.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!["DRAFT", "CANCELLED"].includes(order.status)) {
      return NextResponse.json({ error: "Only draft or cancelled orders can be deleted" }, { status: 400 });
    }

    // Wrap delete operations in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete linked invoices (only unpaid ones)
      await tx.invoice.deleteMany({ where: { orderId: id, status: { in: ["DRAFT", "PENDING"] } } });
      await tx.orderItem.deleteMany({ where: { orderId: id } });
      await tx.order.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[orders/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
