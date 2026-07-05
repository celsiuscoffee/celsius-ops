import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { adjustStockBalance } from "@/lib/stock";
import { getSession } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const { status } = body;

  // Outlet scope: a non-admin may only act on a transfer they're an endpoint
  // of (source or destination outlet). Without this, any staffer could
  // complete any transfer by id and inject stock into an arbitrary outlet
  // (adjustStockBalance(toOutletId, …) below).
  const existing = await prisma.stockTransfer.findUnique({
    where: { id },
    select: { fromOutletId: true, toOutletId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  if (
    !isAdmin &&
    session.outletId !== existing.fromOutletId &&
    session.outletId !== existing.toOutletId
  ) {
    return NextResponse.json({ error: "Transfer not in your outlet" }, { status: 403 });
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
}
