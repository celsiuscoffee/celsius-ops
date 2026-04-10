import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { status, invoiceNumber, dueDate, notes, amount, photos } = body;

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (invoiceNumber !== undefined) data.invoiceNumber = invoiceNumber;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
    if (notes !== undefined) data.notes = notes;
    if (amount !== undefined) data.amount = amount;
    if (photos !== undefined) data.photos = photos;

    const invoice = await prisma.invoice.update({
      where: { id },
      data,
    });

    return NextResponse.json(invoice);
  } catch (err) {
    console.error("[invoices/[id] PATCH]", err);
    const message = err instanceof Error ? err.message : "Failed to update invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
