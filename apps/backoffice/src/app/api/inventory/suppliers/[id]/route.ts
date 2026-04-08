import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    // Only allow specific fields to prevent mass-assignment
    const { name, phone, email, location, leadTimeDays, status, tags, moq, paymentTerms, deliveryDays, notes } = body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (email !== undefined) data.email = email;
    if (location !== undefined) data.location = location;
    if (leadTimeDays !== undefined) data.leadTimeDays = leadTimeDays;
    if (status !== undefined) data.status = status;
    if (tags !== undefined) data.tags = tags;
    if (moq !== undefined) data.moq = moq;
    if (paymentTerms !== undefined) data.paymentTerms = paymentTerms;
    if (deliveryDays !== undefined) data.deliveryDays = deliveryDays;
    if (notes !== undefined) data.notes = notes;

    const supplier = await prisma.supplier.update({
      where: { id },
      data,
    });

    return NextResponse.json(supplier);
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2003") {
      return NextResponse.json({ error: "Cannot update supplier: related records exist" }, { status: 409 });
    }
    console.error("[suppliers/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.supplier.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2003") {
      return NextResponse.json({ error: "Cannot delete supplier: it is referenced by existing orders or receivings" }, { status: 409 });
    }
    console.error("[suppliers/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
