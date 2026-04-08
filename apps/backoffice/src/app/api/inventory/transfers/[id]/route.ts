import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { status } = body;

    // Guard against double-completion
    if (status === "COMPLETED") {
      const existing = await prisma.stockTransfer.findUnique({ where: { id }, select: { status: true } });
      if (!existing) {
        return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
      }
      if (existing.status === "COMPLETED") {
        return NextResponse.json({ error: "Transfer already completed" }, { status: 400 });
      }
    }

    const data: Record<string, unknown> = { status };

    if (status === "COMPLETED") {
      data.completedAt = new Date();
    }

    const transfer = await prisma.stockTransfer.update({
      where: { id },
      data,
      include: { items: true },
    });

    // When transfer is completed, add stock to destination outlet
    if (status === "COMPLETED") {
      for (const item of transfer.items) {
        await adjustStockBalance(transfer.toOutletId, item.productId, Number(item.quantity));
      }
    }

    return NextResponse.json(transfer);
  } catch (err) {
    console.error("[transfers/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
