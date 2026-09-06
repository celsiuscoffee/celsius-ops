import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { AuthError, getUserFromHeaders, requireRole, type SessionUser } from "@/lib/auth";
import { computeDepositAmount } from "@/lib/inventory/deposit";
import { mintPlaceholderNumber } from "@/lib/inventory/placeholder-number";
import { sendPurchaseOrder } from "@/lib/inventory/procurement-po-send";
import { guardOrderLinePrices, type PoLineInput } from "@/lib/inventory/po-price-guard";
import { poTransitionError } from "@/lib/inventory/po-status";

// Middleware skips /api/*, so every handler gates itself. Reading a PO needs a
// backoffice session; changing or deleting one needs a purchasing role.
const PO_WRITE_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;
// A manual `totalAmount` override (no item edits) is an accounting correction —
// owner/admin only. Managers change the total through the line items.
const TOTAL_OVERRIDE_ROLES: readonly string[] = ["OWNER", "ADMIN"];

async function requirePoWriter(req: NextRequest): Promise<SessionUser | NextResponse> {
  try {
    return await requireRole(req.headers, ...PO_WRITE_ROLES);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }
}

const isMoney = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

type ItemEdit = { id: string; quantity?: number; unitPrice?: number; remove?: boolean };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await getUserFromHeaders(req.headers);
    if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        outlet: true,
        supplier: true,
        items: { include: { product: true, productPackage: true } },
        invoices: { orderBy: { createdAt: "desc" } },
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
    const auth = await requirePoWriter(req);
    if (auth instanceof NextResponse) return auth;
    const caller = auth;

    const { id } = await params;
    const body = await req.json();
    const { status, totalAmount, deliveryDate, items, invoicePhotos } = body;
    const deliveryChargeInput: number | null | undefined = body.deliveryCharge;

    // Load the current row first: the status machine needs the FROM state and
    // every line edit below must be scoped to lines that belong to THIS PO.
    const existingOrder = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        deliveryCharge: true,
        items: { select: { id: true, productId: true, productPackageId: true, quantity: true, unitPrice: true } },
      },
    });
    if (!existingOrder) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const lineById = new Map(existingOrder.items.map((i) => [i.id, i]));

    const data: Record<string, unknown> = {};

    // Status machine — refuse anything the table doesn't allow (a stale tab
    // re-approving a COMPLETED PO, DRAFT → COMPLETED with nothing received, …).
    if (status !== undefined) {
      const transitionError = poTransitionError(existingOrder.status, status);
      if (transitionError) {
        return NextResponse.json(
          { error: transitionError, code: "INVALID_STATUS_TRANSITION", from: existingOrder.status, to: status },
          { status: 409 },
        );
      }
    }
    const statusChanged = !!status && status !== existingOrder.status;

    // Block PO cancellation if any linked invoice is INITIATED / DEPOSIT_PAID
    // / PAID — those represent payments mid-flight or money already moved
    // and need manual reversal first. Placeholder + real-but-PENDING invoices
    // are fine to cancel through (placeholders cascade-delete below).
    if (status === "CANCELLED") {
      // GOODS RECEIVED = not cancellable. A (partially) received PO has stock
      // already incremented and a GRNI payable the supplier WILL bill — the
      // cascade below would delete that payable while the goods stay on the
      // shelf. Close the PO short instead (mark COMPLETED keeps the payable
      // at the received total, which the receiving reconcile already set).
      const received = await prisma.receiving.findFirst({ where: { orderId: id }, select: { id: true } });
      if (received) {
        return NextResponse.json(
          {
            error:
              "Cannot cancel — goods were already received against this PO. " +
              "To close a short delivery, mark the PO Completed instead (the total already reflects what arrived); the supplier will still bill the received goods.",
          },
          { status: 400 },
        );
      }
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

      if (status === "APPROVED" && statusChanged) {
        data.approvedById = caller.id;
        data.approvedAt = new Date();
      }

      // Capture transmit timestamp on first transition to a "supplier has it"
      // state. Order flow used to step through SENT before AWAITING_DELIVERY,
      // but the new flow goes straight to AWAITING_DELIVERY — both should
      // stamp sentAt so audit/lead-time analytics keep working.
      if ((status === "SENT" || status === "AWAITING_DELIVERY") && statusChanged) {
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

    // Validate item edits BEFORE writing anything, so a refused line leaves
    // the PO untouched: every id must be one of this PO's lines, and a changed
    // unit price goes through the price↔package guard (same rule as create).
    let itemEdits: ItemEdit[] | null = null;
    if (items !== undefined) {
      if (!Array.isArray(items)) {
        return NextResponse.json({ error: "items must be an array" }, { status: 400 });
      }
      itemEdits = [];
      const guardLines: PoLineInput[] = [];
      for (const raw of items as Partial<ItemEdit>[]) {
        if (!raw || typeof raw.id !== "string") {
          return NextResponse.json({ error: "Each item edit needs an id" }, { status: 400 });
        }
        const line = lineById.get(raw.id);
        if (!line) {
          return NextResponse.json({ error: `Line ${raw.id} does not belong to this PO` }, { status: 400 });
        }
        if (raw.remove) {
          itemEdits.push({ id: raw.id, remove: true });
          continue;
        }
        if (raw.quantity !== undefined && !isMoney(raw.quantity)) {
          return NextResponse.json({ error: "quantity must be a non-negative number" }, { status: 400 });
        }
        if (raw.unitPrice !== undefined && !isMoney(raw.unitPrice)) {
          return NextResponse.json({ error: "unitPrice must be a non-negative number" }, { status: 400 });
        }
        if (raw.unitPrice !== undefined && raw.unitPrice !== Number(line.unitPrice)) {
          guardLines.push({ productId: line.productId, productPackageId: line.productPackageId, unitPrice: raw.unitPrice });
        }
        itemEdits.push({ id: raw.id, quantity: raw.quantity, unitPrice: raw.unitPrice });
      }
      if (guardLines.length > 0) {
        const priceGuard = await guardOrderLinePrices(guardLines, {
          override: body.overridePriceGuard === true,
        });
        if (!priceGuard.ok) return priceGuard.response;
      }
    }

    // Update individual items (quantity, unitPrice, or remove) — every write
    // is scoped to { id, orderId } so a foreign line id can't be touched.
    if (itemEdits) {
      for (const item of itemEdits) {
        if (item.remove) {
          await prisma.orderItem.deleteMany({ where: { id: item.id, orderId: id } });
          continue;
        }
        const line = lineById.get(item.id);
        if (!line) continue;
        const itemData: Record<string, unknown> = {};
        if (item.quantity !== undefined) itemData.quantity = item.quantity;
        if (item.unitPrice !== undefined) itemData.unitPrice = item.unitPrice;
        if (item.quantity !== undefined || item.unitPrice !== undefined) {
          // Recalculate totalPrice
          const qty = item.quantity ?? Number(line.quantity);
          const price = item.unitPrice ?? Number(line.unitPrice);
          itemData.totalPrice = qty * price;
          await prisma.orderItem.updateMany({ where: { id: item.id, orderId: id }, data: itemData });
        }
      }

      // Recalculate order total from remaining items + delivery charge.
      // Pull the delivery charge from this PATCH if supplied, else from
      // the existing row, so we don't accidentally reset it to 0 when
      // someone edits items without touching delivery.
      const remaining = await prisma.orderItem.findMany({ where: { orderId: id } });
      const itemsTotal = remaining.reduce((sum, i) => sum + Number(i.totalPrice), 0);
      const dc = effectiveDeliveryCharge ?? (existingOrder.deliveryCharge ? Number(existingOrder.deliveryCharge) : 0);
      data.totalAmount = itemsTotal + dc;
    } else if (totalAmount !== undefined) {
      // Manual total override (only if no item edits) — owner/admin only.
      if (!TOTAL_OVERRIDE_ROLES.includes(caller.role)) {
        return NextResponse.json(
          { error: "Only an owner or admin can override the PO total directly — edit the line items instead." },
          { status: 403 },
        );
      }
      if (!isMoney(totalAmount)) {
        return NextResponse.json({ error: "totalAmount must be a non-negative number" }, { status: 400 });
      }
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

    // Auto-send the order block to the supplier on the SENT / AWAITING_DELIVERY
    // transition (flag-gated + automationMode dial + de-duped per PO). Awaited so it
    // runs to completion before the response; it's internally guarded and never throws.
    if (status === "SENT" || status === "AWAITING_DELIVERY") {
      await sendPurchaseOrder(order);
    }

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
      try {
        // Ensure invoice exists — saveEdit() usually creates it, but
        // guard against edge cases (PATCH called before saveEdit ran,
        // or fired by a different surface).
        //
        // Two races we explicitly defend against here:
        //   1) Two concurrent PATCH AWAITING_DELIVERY calls on the same
        //      PO (e.g. double-tap, retry, or Save+Confirm overlap).
        //      Both used to pass the findFirst check and both insert →
        //      twin placeholder invoices, both billable.
        //   2) saveEdit + this handler racing — same shape, same fix.
        //
        // Defense: the partial unique index added in migration
        // 20260515_po_idempotency_placeholder_invoice_dedup makes a
        // second PENDING placeholder for the same orderId impossible at
        // the DB level. We attempt the create unconditionally and treat
        // P2002 as "another caller already created it, we're done".
        const existingInvoice = await prisma.invoice.findFirst({ where: { orderId: id } });
        if (!existingInvoice) {
          const placeholderNumber = await mintPlaceholderNumber(prisma, order.outletId);
          const depositAmount = await computeDepositAmount(order.supplierId, Number(order.totalAmount));
          try {
            await prisma.invoice.create({
              data: {
                invoiceNumber: placeholderNumber,
                orderId: id,
                outletId: order.outletId,
                supplierId: order.supplierId,
                amount: order.totalAmount,
                status: "PENDING",
                photos: invoicePhotos || [],
                ...(depositAmount ? { depositAmount } : {}),
              },
            });
          } catch (e) {
            const code = (e as { code?: string }).code;
            // P2002 from the partial unique index = another concurrent
            // request already inserted the placeholder. Swallow it and
            // continue — the desired end state is achieved.
            if (code !== "P2002") throw e;
            console.log(
              `[orders/[id] PATCH] Placeholder invoice already exists for PO ${id} (concurrent insert raced)`,
            );
          }
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePoWriter(req);
    if (auth instanceof NextResponse) return auth;

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
