import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkModuleAccess } from "@/lib/check-module-access";

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
  return NextResponse.json(invoice);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkModuleAccess(req, "inventory:invoices");
  if (!guard.ok) return guard.response;
  const { id } = await params;
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
