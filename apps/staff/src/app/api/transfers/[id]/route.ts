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
  // Only known statuses. An arbitrary string was accepted straight into the
  // column before.
  const ALLOWED_STATUS = ["PENDING", "COMPLETED", "CANCELLED"];
  if (!ALLOWED_STATUS.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const existing = await prisma.stockTransfer.findUnique({
    where: { id },
    select: { fromOutletId: true, toOutletId: true, status: true },
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

  // Idempotency: completing adds stock to the destination. Without this guard
  // a repeated PATCH{status:"COMPLETED"} re-ran adjustStockBalance every call,
  // inflating destination stock arbitrarily. A transfer already in its target
  // status is a no-op, not a re-run.
  if (existing.status === status) {
    return NextResponse.json({ error: `Transfer is already ${status}` }, { status: 409 });
  }
  if (existing.status === "COMPLETED") {
    return NextResponse.json(
      { error: "This transfer is already completed and can't be changed" },
      { status: 409 },
    );
  }

  const data: Record<string, unknown> = { status };

  if (status === "COMPLETED") {
    data.completedAt = new Date();
  }

  const transfer = await prisma.stockTransfer.update({
    where: { id },
    data,
    include: { items: { include: { productPackage: true } } },
  });

  // When transfer is completed, add stock to destination outlet — in base UOM,
  // converting the package-unit line quantity through its factor (mirrors the
  // deduction on creation; both used to move the raw figure).
  if (status === "COMPLETED") {
    for (const item of transfer.items) {
      await adjustStockBalance(
        transfer.toOutletId,
        item.productId,
        Number(item.quantity) * Number(item.productPackage?.conversionFactor ?? 1),
      );
    }
  }

  return NextResponse.json(transfer);
}
