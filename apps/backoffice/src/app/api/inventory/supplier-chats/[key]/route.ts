import { NextResponse, NextRequest } from "next/server";
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

// One supplier thread: the full message history for a counterparty number,
// the matched supplier, the right-panel procurement context (open POs, unpaid +
// overdue totals), and whether the 24h free-reply window is open.

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key } = await params; // counterparty number (digits)
  const counter = { OR: [{ fromNumber: key }, { toNumber: key }] };

  const messages = await prisma.whatsAppMessage.findMany({
    where: counter,
    orderBy: { timestamp: "asc" },
    take: 500,
    select: {
      id: true,
      direction: true,
      type: true,
      body: true,
      mediaUrl: true,
      status: true,
      timestamp: true,
    },
  });

  const supplierId =
    (
      await prisma.whatsAppMessage.findFirst({
        where: { ...counter, supplierId: { not: null } },
        select: { supplierId: true },
      })
    )?.supplierId ?? null;

  let supplier:
    | null
    | {
        id: string;
        name: string;
        phone: string | null;
        deliveryDays: string[];
        paymentTerms: string | null;
        leadTimeDays: number;
      } = null;
  let context = {
    openPOs: 0,
    unpaidTotal: 0,
    overdueTotal: 0,
    recentPOs: [] as { orderNumber: string; status: string }[],
  };

  if (supplierId) {
    const closedStatuses: OrderStatus[] = ["COMPLETED", "CANCELLED"];
    const openFilter = { supplierId, status: { notIn: closedStatuses } };
    const [s, openPOs, recentPOs, unpaid, overdue] = await Promise.all([
      prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, name: true, phone: true, deliveryDays: true, paymentTerms: true, leadTimeDays: true },
      }),
      prisma.order.count({ where: openFilter }),
      prisma.order.findMany({
        where: openFilter,
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { orderNumber: true, status: true },
      }),
      prisma.invoice.aggregate({
        where: { supplierId, status: { not: "PAID" } },
        _sum: { amount: true, amountPaid: true },
      }),
      prisma.invoice.aggregate({
        where: { supplierId, status: { not: "PAID" }, dueDate: { lt: new Date() } },
        _sum: { amount: true, amountPaid: true },
      }),
    ]);
    supplier = s;
    const bal = (a: { _sum: { amount: unknown; amountPaid: unknown } }) =>
      Math.max(0, Number(a._sum.amount ?? 0) - Number(a._sum.amountPaid ?? 0));
    context = {
      openPOs,
      unpaidTotal: bal(unpaid),
      overdueTotal: bal(overdue),
      recentPOs: recentPOs.map((o) => ({ orderNumber: o.orderNumber, status: o.status })),
    };
  }

  // 24h free-reply window = the supplier messaged us within the last 24h.
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const windowOpen =
    !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < 24 * 60 * 60 * 1000;

  return NextResponse.json({ key, supplierId, supplier, context, windowOpen, messages });
}
