import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkModuleAccess, isManagerRole } from "@/lib/check-module-access";
import type { SessionUser } from "@celsius/auth";

// A non-manager may only touch invoices for their own outlet (the outlet is on
// the linked order; ad-hoc / staff-claim invoices have no order and stay
// visible to everyone, mirroring the list route). Managers/owner/admin are
// unrestricted. Without this, any holder of `inventory:invoices` could read —
// or rewrite the payable `amount` of — any outlet's invoice by id.
async function canAccessInvoice(session: SessionUser, invoiceId: string): Promise<boolean> {
  if (isManagerRole(session.role)) return true;
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { order: { select: { outletId: true } } },
  });
  if (!inv) return true; // let the handler return its own 404
  if (!inv.order) return true; // ad-hoc / staff-claim invoice, no outlet to scope by
  return inv.order.outletId === session.outletId;
}

// Single invoice detail + attach-invoice action from native staff.
// Both reads and the attach flow require `inventory:invoices`.
//
// Attach flow (PATCH with `invoiceNumber` + `dueDate` + optional `photos`):
// turns a GRNI placeholder (auto-created on receiving, with INV-NNNN
// number, no due date, status=PENDING) into a real supplier invoice.
// Once attached the invoice drops out of the "Pending Invoice" card
// and into the regular Payable list.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkModuleAccess(req, "inventory:invoices");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!(await canAccessInvoice(guard.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          totalAmount: true,
          outlet: { select: { name: true, code: true } },
        },
      },
    },
  });
  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Serialize Prisma Decimals to numbers (raw Prisma emits them as strings),
  // mirroring the list route (apps/staff/src/app/api/invoices/route.ts). The
  // native detail screen (apps/staff-native/app/(staff)/invoices/[id].tsx)
  // reads amount/amountPaid/depositAmount and order.totalAmount as numbers.
  return NextResponse.json({
    ...invoice,
    amount: Number(invoice.amount),
    amountPaid: invoice.amountPaid != null ? Number(invoice.amountPaid) : null,
    depositAmount:
      invoice.depositAmount != null ? Number(invoice.depositAmount) : null,
    order: invoice.order
      ? { ...invoice.order, totalAmount: Number(invoice.order.totalAmount) }
      : invoice.order,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkModuleAccess(req, "inventory:invoices");
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!(await canAccessInvoice(guard.session, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  const { invoiceNumber, dueDate, photos, amount, notes } = body;

  const data: Record<string, unknown> = {};
  if (typeof invoiceNumber === "string" && invoiceNumber.trim()) {
    data.invoiceNumber = invoiceNumber.trim();
  }
  if (typeof dueDate === "string" && dueDate) {
    data.dueDate = new Date(dueDate);
  }
  if (Array.isArray(photos)) {
    data.photos = photos;
  }
  if (typeof amount === "number" && Number.isFinite(amount)) {
    data.amount = amount;
  }
  if (typeof notes === "string") {
    data.notes = notes || null;
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data,
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      status: true,
      dueDate: true,
      photos: true,
    },
  });
  return NextResponse.json(updated);
}
