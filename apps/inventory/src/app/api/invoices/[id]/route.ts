import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  const invoice = await prisma.invoice.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json(invoice);
}
