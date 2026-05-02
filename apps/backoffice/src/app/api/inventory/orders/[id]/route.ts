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
    const deliveryChargeInput: number | null | undefined = body.deliveryCharge;

    const data: Record<string, unknown> = {};

    // Block PO cancellation if any linked invoice is INITIATED / DEPOSIT_PAID
    // / PAID — those represent payments mid-flight or money already moved
    // and need manual reversal first. Placeholder + real-but-PENDING invoices
    // are fine to cancel through (placeholders cascade-delete below).
    if (status === "CANCELLED") {
      const blockingInvoice = await prisma.invoice.findFirst({
        where: {
          orderId: id,
          // PARTIALLY_PAID added — if any payment has landed, money has
          // already moved and we can't allow cancellation without an
          // explicit reversal first.
          status: { in: ["INITIATED", "PARTIALLY_PAID", "DEPOSIT_PAID", "PAID"] },
        },
        select: { invoiceNumber: true, status: true, amount: true },
      });
      if (blockingInvoice) {
        const verb =
          blockingInvoice.status === "PAID" ? "is already paid" :
          blockingInvoice.status === "DEPOSIT_PAID" ? "has a paid deposit" :
          blockingInvoice.status === "PARTIALLY_PAID" ? "has a partial payment recorded" :
          "has payment initiated";
        return NextResponse.json(
          {
            error: `Cannot cancel — invoice ${blockingInvoice.invoiceNumber} (RM ${Number(blockingInvoice.amount).toFixed(2)}) ${verb}. Reverse the payment first, then cancel.`,
          },
          { status: 400 },
        );
      }
    }

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

    // Persist the supplier's delivery charge separately so we can re-edit
    // it later without re-extracting the invoice. null/0 → no charge.
    let effectiveDeliveryCharge: number | null = null;
    if (deliveryChargeInput === null) {
      data.deliveryCharge = 0;
      effectiveDeliveryCharge = 0;
    } else if (typeof deliveryChargeInput === "number" && deliveryChargeInput >= 0) {
      data.deliveryCharge = deliveryChargeInput;
      effectiveDeliveryCharge = deliveryChargeInput;
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

      // Recalculate order total from remaining items + delivery charge.
      // Pull the delivery charge from this PATCH if supplied, else from
      // the existing row, so we don't accidentally reset it to 0 when
      // someone edits items without touching delivery.
      const remaining = await prisma.orderItem.findMany({ where: { orderId: id } });
      const itemsTotal = remaining.reduce((sum, i) => sum + Number(i.totalPrice), 0);
      let dc = effectiveDeliveryCharge;
      if (dc === null) {
        const existing = await prisma.order.findUnique({ where: { id }, select: { deliveryCharge: true } });
        dc = existing?.deliveryCharge ? Number(existing.deliveryCharge) : 0;
      }
      data.totalAmount = itemsTotal + dc;
    } else if (totalAmount !== undefined) {
      // Manual total override (only if no item edits)
      data.totalAmount = totalAmount;
    } else if (effectiveDeliveryCharge !== null) {
      // Delivery charge changed but items didn't — recompute total from
      // current items + the new charge.
      const remaining = await prisma.orderItem.findMany({ where: { orderId: id } });
      const itemsTotal = remaining.reduce((sum, i) => sum + Number(i.totalPrice), 0);
      data.totalAmount = itemsTotal + effectiveDeliveryCharge;
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
