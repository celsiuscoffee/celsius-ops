import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkModuleAccess, isManagerRole } from "@/lib/check-module-access";

// Single PO detail + status updates from the native staff app.
//
// Module gate: `inventory:orders`. Status mutations (approve/send/
// cancel) additionally require manager role — regular staff with read
// access can view but not transition.
//
// Read access: any authenticated staff. The native app already filters
// the list by outlet on the client; detail reads are by ID so we just
// trust the URL (same pattern as audit/[id] etc).
//
// Status updates: APPROVED stamps approver. AWAITING_DELIVERY (the
// "send to supplier" action — the legacy SENT state was retired) stamps
// sentAt. CANCELLED is allowed only if no invoice has had money move
// against it (mirrors the backoffice guard).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkModuleAccess(req, "inventory:orders");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      outlet: { select: { name: true, code: true } },
      supplier: {
        select: {
          id: true,
          name: true,
          phone: true,
          depositPercent: true,
          depositTermsDays: true,
        },
      },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              baseUom: true,
              shelfLifeDays: true,
            },
          },
          productPackage: {
            select: { packageLabel: true, packageName: true },
          },
        },
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          status: true,
          dueDate: true,
          paidAt: true,
        },
      },
      _count: { select: { receivings: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Flatten to the same shape the LIST route emits (see
  // apps/staff/src/app/api/orders/route.ts) so the native detail screen
  // (apps/staff-native/app/(staff)/orders/[id].tsx, OrderDetail in
  // apps/staff-native/lib/ops/orders.ts) reads flat string fields,
  // `supplier`/`outlet`/`product` are names, Decimals become numbers.
  // `invoices[]` is passed through as the native list expects it.
  return NextResponse.json({
    id: order.id,
    orderNumber: order.orderNumber,
    outlet: order.outlet.name,
    outletCode: order.outlet.code,
    supplierId: order.supplier?.id ?? "",
    supplier: order.supplier?.name ?? "Unknown",
    supplierPhone: order.supplier?.phone ?? "",
    status: order.status,
    totalAmount: Number(order.totalAmount),
    notes: order.notes,
    deliveryDate: order.deliveryDate?.toISOString().split("T")[0] ?? null,
    createdBy: order.createdBy?.name ?? "",
    approvedBy: order.approvedBy?.name ?? null,
    approvedAt: order.approvedAt?.toISOString() ?? null,
    sentAt: order.sentAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((i) => ({
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
    })),
    invoices: order.invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount),
      status: inv.status,
      dueDate: inv.dueDate?.toISOString() ?? null,
      paidAt: inv.paidAt?.toISOString() ?? null,
    })),
    receivingCount: order._count.receivings,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkModuleAccess(req, "inventory:orders");
  if (!guard.ok) return guard.response;
  const caller = guard.session;
  // Mutations (approve/send/cancel) — managers only. Read access is
  // open to anyone with the module key.
  if (!isManagerRole(caller.role)) {
    return NextResponse.json(
      { error: "Manager role required to update PO status" },
      { status: 403 },
    );
  }
  const { id } = await params;
  const body = await req.json();
  const { status, deliveryDate, notes } = body;

  const data: Record<string, unknown> = {};

  if (status === "CANCELLED") {
    // Same guard as backoffice — block cancellation if any linked
    // invoice has money in flight or already moved.
    const blocking = await prisma.invoice.findFirst({
      where: {
        orderId: id,
        status: { in: ["INITIATED", "PARTIALLY_PAID", "DEPOSIT_PAID", "PAID"] },
      },
      select: { invoiceNumber: true, status: true, amount: true },
    });
    if (blocking) {
      const verb =
        blocking.status === "PAID"
          ? "is already paid"
          : blocking.status === "DEPOSIT_PAID"
            ? "has a paid deposit"
            : blocking.status === "PARTIALLY_PAID"
              ? "has a partial payment"
              : "has payment initiated";
      return NextResponse.json(
        {
          error: `Cannot cancel — invoice ${blocking.invoiceNumber} (RM ${Number(blocking.amount).toFixed(2)}) ${verb}. Reverse the payment first.`,
        },
        { status: 400 },
      );
    }
  }

  if (status) {
    data.status = status;
    if (status === "APPROVED") {
      data.approvedById = caller.id;
      data.approvedAt = new Date();
    }
    if (
      status === "SENT" ||
      status === "AWAITING_DELIVERY"
    ) {
      data.sentAt = new Date();
    }
  }
  if (typeof deliveryDate === "string") {
    data.deliveryDate = deliveryDate ? new Date(deliveryDate) : null;
  }
  if (typeof notes === "string") data.notes = notes || null;

  const updated = await prisma.order.update({
    where: { id },
    data,
    select: {
      id: true,
      status: true,
      approvedAt: true,
      sentAt: true,
      deliveryDate: true,
      notes: true,
    },
  });
  return NextResponse.json(updated);
}
