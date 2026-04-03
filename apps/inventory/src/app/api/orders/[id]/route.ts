import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      branch: true,
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
  const { status } = body;

  const data: Record<string, unknown> = { status };

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

  const order = await prisma.order.update({
    where: { id },
    data,
  });

  return NextResponse.json(order);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const order = await prisma.order.findUnique({ where: { id }, select: { status: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!["DRAFT", "CANCELLED"].includes(order.status)) {
    return NextResponse.json({ error: "Only draft or cancelled orders can be deleted" }, { status: 400 });
  }

  await prisma.orderItem.deleteMany({ where: { orderId: id } });
  await prisma.order.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
