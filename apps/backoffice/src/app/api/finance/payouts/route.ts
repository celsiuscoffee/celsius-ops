// GET /api/finance/payouts?from=YYYY-MM-DD&to=YYYY-MM-DD
// Revenue Monster payout (daily settlement) batches, auto-synced by the
// apps/order /api/cron/sync-rm-payouts cron. Powers the /finance Payouts page.
// Date-windowed server-side (default last 3 months); filtered/sorted client-side.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const defFrom = new Date();
  defFrom.setMonth(defFrom.getMonth() - 3);
  const gte = from ? new Date(`${from}T00:00:00.000Z`) : defFrom;
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;

  const rows = await prisma.rmPayout.findMany({
    where: { settlementDate: lte ? { gte, lte } : { gte } },
    select: {
      id: true,
      settlementDate: true,
      method: true,
      sequence: true,
      storeId: true,
      entityName: true,
      txnCount: true,
      grossTotal: true,
      mdrFee: true,
      netTotal: true,
      status: true,
      // Linked-line count for the reconciliation badge (how many of the
      // batch's transactions resolved to a Celsius order).
      _count: { select: { lines: { where: { orderId: { not: null } } } } },
    },
    orderBy: [{ settlementDate: "desc" }, { id: "desc" }],
    take: 5000,
  });

  return NextResponse.json({
    from: (from ? gte : defFrom).toISOString().slice(0, 10),
    to: to ?? null,
    payouts: rows.map((r) => ({
      id: r.id,
      settlementDate: r.settlementDate.toISOString().slice(0, 10),
      method: r.method,
      sequence: r.sequence,
      storeId: r.storeId,
      entityName: r.entityName,
      txnCount: r.txnCount,
      gross: Number(r.grossTotal),
      mdrFee: Number(r.mdrFee),
      net: Number(r.netTotal),
      status: r.status,
      linkedCount: r._count.lines,
    })),
  });
}
