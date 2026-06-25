import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

// Threads for the Supplier Chats inbox: folds WhatsAppMessage rows into one
// thread per counterparty (the supplier's number) with a preview + a
// "needs attention" flag (OOS/substitution language, or an overdue invoice).

// Inbound lines likely needing a human — EN + Malay. Tune as real data lands.
const ATTENTION_RX =
  /out of stock|no stock|\boos\b|unavailable|sold out|tak ?ada|x ?ada|takde|habis|cancel|delay|short/i;

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // v1: pull recent messages and fold into threads in JS (store is new + low
  // volume). Switch to a SQL window query if it grows large.
  const rows = await prisma.whatsAppMessage.findMany({
    orderBy: { timestamp: "desc" },
    take: 1000,
    select: {
      direction: true,
      fromNumber: true,
      toNumber: true,
      supplierId: true,
      body: true,
      type: true,
      timestamp: true,
    },
  });

  type T = {
    key: string;
    supplierId: string | null;
    preview: string;
    lastAt: Date;
    count: number;
    lastInbound: string | null;
  };
  const threads = new Map<string, T>();
  for (const m of rows) {
    const counter = m.direction === "inbound" ? m.fromNumber : m.toNumber;
    if (!counter) continue;
    let t = threads.get(counter);
    if (!t) {
      t = {
        key: counter,
        supplierId: m.supplierId,
        preview: m.body ?? `[${m.type}]`,
        lastAt: m.timestamp,
        count: 0,
        lastInbound: null,
      };
      threads.set(counter, t);
    }
    t.count++;
    if (m.supplierId && !t.supplierId) t.supplierId = m.supplierId;
    if (m.direction === "inbound" && t.lastInbound === null) t.lastInbound = m.body ?? `[${m.type}]`;
  }

  const supplierIds = [
    ...new Set([...threads.values()].map((t) => t.supplierId).filter((x): x is string => !!x)),
  ];
  const [suppliers, overdueRows] = await Promise.all([
    supplierIds.length
      ? prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true, phone: true },
        })
      : Promise.resolve([]),
    supplierIds.length
      ? prisma.invoice.findMany({
          where: { supplierId: { in: supplierIds }, status: { not: "PAID" }, dueDate: { lt: new Date() } },
          select: { supplierId: true },
          distinct: ["supplierId"],
        })
      : Promise.resolve([]),
  ]);
  const sup = new Map(suppliers.map((s) => [s.id, s]));
  const overdue = new Set(overdueRows.map((o) => o.supplierId));

  const out = [...threads.values()]
    .map((t) => {
      const s = t.supplierId ? sup.get(t.supplierId) : undefined;
      const needsAttention =
        (!!t.lastInbound && ATTENTION_RX.test(t.lastInbound)) ||
        (!!t.supplierId && overdue.has(t.supplierId));
      return {
        key: t.key,
        supplierId: t.supplierId,
        name: s?.name ?? `+${t.key}`,
        phone: s?.phone ?? t.key,
        preview: t.preview.slice(0, 60),
        lastAt: t.lastAt,
        count: t.count,
        needsAttention,
      };
    })
    .sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));

  return NextResponse.json({ threads: out, needsAttention: out.filter((t) => t.needsAttention).length });
}
