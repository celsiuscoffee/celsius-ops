import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { computeDepositAmount } from "@/lib/inventory/deposit";

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

      // Capture transmit timestamp on first transition to a "supplier has it"
      // state. Order flow used to step through SENT before AWAITING_DELIVERY,
      // but the new flow goes straight to AWAITING_DELIVERY — both should
      // stamp sentAt so audit/lead-time analytics keep working.
      if (status === "SENT" || status === "AWAITING_DELIVERY") {
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

    // Cascade cancel: when a PO is cancelled, drop any GRNI placeholder
    // invoices auto-attached to it. Without this, the placeholder lingers
    // forever in the Pending Invoice card after the PO is dead. Real
    // (non-placeholder) invoices and any PAID/INITIATED records are left
    // alone — those represent commitments or money already moved and
    // require manual handling.
    if (status === "CANCELLED") {
      try {
        const deleted = await prisma.invoice.deleteMany({
          where: {
            orderId: id,
            status: "PENDING",
            dueDate: null,
            invoiceNumber: { startsWith: "INV-" },
          },
        });
        if (deleted.count > 0) {
          console.log(`[orders/[id] PATCH] Cascaded ${deleted.count} placeholder invoice(s) on PO cancel: ${id}`);
        }
      } catch (e) {
        console.error("[orders/[id] PATCH] Placeholder cascade-delete failed:", e);
      }
    }

    // Auto-create invoice + receiving when order is confirmed (AWAITING_DELIVERY)
    if (status === "AWAITING_DELIVERY") {
      const caller = await getUserFromHeaders(req.headers);

      try {
        // Ensure invoice exists — saveEdit() usually creates it, but guard against edge cases
        const existingInvoice = await prisma.invoice.findFirst({ where: { orderId: id } });
        if (!existingInvoice) {
          const invCount = await prisma.invoice.count();
          const depositAmount = await computeDepositAmount(order.supplierId, Number(order.totalAmount));
          await prisma.invoice.create({
            data: {
              invoiceNumber: `INV-${String(invCount + 1).padStart(4, "0")}`,
              orderId: id,
              outletId: order.outletId,
              supplierId: order.supplierId,
              amount: order.totalAmount,
              status: "PENDING",
              photos: invoicePhotos || [],
              ...(depositAmount ? { depositAmount } : {}),
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
