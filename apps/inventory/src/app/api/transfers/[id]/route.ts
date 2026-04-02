import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  const data: Record<string, unknown> = { status };

  if (status === "COMPLETED") {
    data.completedAt = new Date();
  }

  const transfer = await prisma.stockTransfer.update({
    where: { id },
    data,
    include: { items: true },
  });

  // When transfer is completed, add stock to destination branch
  if (status === "COMPLETED") {
    for (const item of transfer.items) {
      await adjustStockBalance(transfer.toBranchId, item.productId, Number(item.quantity));
    }
  }

  return NextResponse.json(transfer);
}
