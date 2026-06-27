import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

// Threads for the Supplier Chats workspace. Folds WhatsAppMessage rows into one
// thread per counterparty, then MERGES in every active supplier — so suppliers with
// no chat yet still appear (you can start one / raise a PO). A non-supplier number
// that has messaged us shows as registered:false (filterable as "Other").

const ATTENTION_RX =
  /out of stock|no stock|\boos\b|unavailable|sold out|tak ?ada|x ?ada|takde|habis|cancel|delay|short/i;

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");
const last8 = (s: string | null | undefined) => digits(s).slice(-8);

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [rows, suppliers] = await Promise.all([
    prisma.whatsAppMessage.findMany({
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
        raw: true,
      },
    }),
    prisma.supplier.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, phone: true, automationMode: true },
    }),
  ]);

  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const byPhone = new Map<string, (typeof suppliers)[number]>();
  for (const s of suppliers) {
    const k = last8(s.phone);
    if (k.length >= 8) byPhone.set(k, s);
  }

  type T = {
    key: string;
    supplierId: string | null;
    preview: string;
    lastAt: Date;
    count: number;
    lastInbound: string | null;
    verifierFailed: boolean;
  };
  const threads = new Map<string, T>();
  for (const m of rows) {
    const counter = m.direction === "inbound" ? m.fromNumber : m.toNumber;
    if (!counter) continue;
    let t = threads.get(counter);
    if (!t) {
      const raw = (m.raw ?? null) as Record<string, unknown> | null;
      const v = raw?.verifier as { rating?: string } | undefined;
      t = {
        key: counter,
        supplierId: m.supplierId,
        preview: m.body ?? `[${m.type}]`,
        lastAt: m.timestamp,
        count: 0,
        lastInbound: null,
        verifierFailed: m.direction === "outbound" && !!raw?.agent && v?.rating === "fail",
      };
      threads.set(counter, t);
    }
    t.count++;
    if (m.supplierId && !t.supplierId) t.supplierId = m.supplierId;
    if (m.direction === "inbound" && t.lastInbound === null) t.lastInbound = m.body ?? `[${m.type}]`;
  }

  // Resolve each thread to a supplier (by soft-matched id, else by phone), and note
  // which suppliers already have a thread so we can append the ones that don't.
  const supplierWithThread = new Set<string>();
  for (const t of threads.values()) {
    const s = (t.supplierId && byId.get(t.supplierId)) || byPhone.get(last8(t.key)) || null;
    if (s) {
      t.supplierId = s.id;
      supplierWithThread.add(s.id);
    }
  }

  const matchedIds = [...supplierWithThread];
  const overdueRows = matchedIds.length
    ? await prisma.invoice.findMany({
        where: { supplierId: { in: matchedIds }, status: { not: "PAID" }, dueDate: { lt: new Date() } },
        select: { supplierId: true },
        distinct: ["supplierId"],
      })
    : [];
  const overdue = new Set(overdueRows.map((o) => o.supplierId));

  type Out = {
    key: string;
    supplierId: string | null;
    name: string;
    phone: string;
    preview: string;
    lastAt: Date | null;
    count: number;
    needsAttention: boolean;
    registered: boolean;
    automationMode: "OFF" | "ASSIST" | "AUTO" | null;
    hasMessages: boolean;
  };

  const out: Out[] = [];
  for (const t of threads.values()) {
    const s = t.supplierId ? byId.get(t.supplierId) : undefined;
    const needsAttention =
      t.verifierFailed ||
      (!!t.lastInbound && ATTENTION_RX.test(t.lastInbound)) ||
      (!!t.supplierId && overdue.has(t.supplierId));
    out.push({
      key: t.key,
      supplierId: t.supplierId,
      name: s?.name ?? `+${t.key}`,
      phone: s?.phone ?? t.key,
      preview: t.preview.slice(0, 60),
      lastAt: t.lastAt,
      count: t.count,
      needsAttention,
      registered: !!s,
      automationMode: s?.automationMode ?? null,
      hasMessages: true,
    });
  }
  // Append every supplier that has no thread yet.
  for (const s of suppliers) {
    if (supplierWithThread.has(s.id)) continue;
    out.push({
      key: digits(s.phone) || s.id,
      supplierId: s.id,
      name: s.name,
      phone: s.phone ?? "",
      preview: "",
      lastAt: null,
      count: 0,
      needsAttention: overdue.has(s.id),
      registered: true,
      automationMode: s.automationMode,
      hasMessages: false,
    });
  }

  out.sort((a, b) => {
    if (a.hasMessages !== b.hasMessages) return a.hasMessages ? -1 : 1; // chats first
    if (a.hasMessages) return +new Date(b.lastAt!) - +new Date(a.lastAt!);
    return a.name.localeCompare(b.name); // then suppliers without chats, A→Z
  });

  const reg = out.filter((t) => t.registered);
  const counts = {
    all: out.length,
    suppliers: reg.length,
    needsAttention: out.filter((t) => t.needsAttention).length,
    other: out.length - reg.length,
    auto: reg.filter((t) => t.automationMode === "AUTO").length,
    assist: reg.filter((t) => t.automationMode === "ASSIST").length,
    off: reg.filter((t) => t.automationMode === "OFF").length,
  };

  return NextResponse.json({ threads: out, counts, needsAttention: counts.needsAttention });
}
