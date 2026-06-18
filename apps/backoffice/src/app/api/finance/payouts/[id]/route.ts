// GET /api/finance/payouts/[id]
// The settled transactions inside one RM payout batch, each linked to its
// Celsius pickup order (order_number) where matched. Drives the Payouts drawer.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const payout = await prisma.rmPayout.findUnique({ where: { id } });
  if (!payout) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lines = await prisma.rmPayoutLine.findMany({
    where: { payoutId: id },
    orderBy: [{ txnTime: "asc" }, { id: "asc" }],
  });

  // Resolve order numbers for the linked orders. `orders` is a raw Supabase
  // table (not a Prisma model), so fetch via the finance service client.
  const orderIds = Array.from(new Set(lines.map((l) => l.orderId).filter(Boolean) as string[]));
  const numberById = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data } = await getFinanceClient()
      .from("orders")
      .select("id, order_number")
      .in("id", orderIds);
    for (const o of (data ?? []) as { id: string; order_number: string }[]) {
      numberById.set(o.id, o.order_number);
    }
  }

  return NextResponse.json({
    payout: {
      id: payout.id,
      settlementDate: payout.settlementDate.toISOString().slice(0, 10),
      method: payout.method,
      sequence: payout.sequence,
      storeId: payout.storeId,
      entityName: payout.entityName,
      txnCount: payout.txnCount,
      gross: Number(payout.grossTotal),
      mdrFee: Number(payout.mdrFee),
      net: Number(payout.netTotal),
      status: payout.status,
    },
    lines: lines.map((l) => ({
      id: l.id,
      rmTransactionId: l.rmTransactionId,
      rmOrderId: l.rmOrderId,
      orderId: l.orderId,
      orderNumber: l.orderId ? numberById.get(l.orderId) ?? null : null,
      gross: Number(l.gross),
      mdrFee: Number(l.mdrFee),
      net: Number(l.net),
      method: l.method,
      txnTime: l.txnTime ? l.txnTime.toISOString() : null,
    })),
  });
}
