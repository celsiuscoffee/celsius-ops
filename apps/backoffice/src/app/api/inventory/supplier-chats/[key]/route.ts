import { NextResponse, NextRequest } from "next/server";
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { paymentModel } from "@/lib/inventory/payment-model";

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
      waMessageId: true,
      direction: true,
      type: true,
      body: true,
      mediaUrl: true,
      status: true,
      timestamp: true,
    },
  });

  let supplierId =
    (
      await prisma.whatsAppMessage.findFirst({
        where: { ...counter, supplierId: { not: null } },
        select: { supplierId: true },
      })
    )?.supplierId ?? null;

  // No message carried a supplierId (e.g. a supplier with no chat yet, opened from
  // the list) — resolve by phone (last-8 digits) so context + "New PO" still work.
  if (!supplierId) {
    const tail = key.replace(/[^0-9]/g, "").slice(-8);
    if (tail.length >= 8) {
      const actives = await prisma.supplier.findMany({
        where: { status: "ACTIVE", phone: { not: null } },
        select: { id: true, phone: true },
      });
      supplierId = actives.find((s) => (s.phone ?? "").replace(/[^0-9]/g, "").slice(-8) === tail)?.id ?? null;
    }
  }

  let supplier:
    | null
    | {
        id: string;
        name: string;
        phone: string | null;
        deliveryDays: string[];
        paymentTerms: string | null;
        leadTimeDays: number;
        automationMode: "OFF" | "ASSIST" | "AUTO";
        paymentModel?: { model: string; label: string; note: string; popDeliveryCritical: boolean };
      } = null;
  let context = {
    openPOs: 0,
    unpaidTotal: 0,
    overdueTotal: 0,
    recentPOs: [] as { id: string; orderNumber: string; status: string }[],
    unpaidInvoices: [] as {
      id: string;
      invoiceNumber: string;
      balance: number;
      status: string;
      dueDate: string | null;
      overdue: boolean;
    }[],
  };

  if (supplierId) {
    const closedStatuses: OrderStatus[] = ["COMPLETED", "CANCELLED"];
    const openFilter = { supplierId, status: { notIn: closedStatuses } };
    const [s, openPOs, recentPOs, unpaid, overdue, unpaidList] = await Promise.all([
      prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, name: true, phone: true, deliveryDays: true, paymentTerms: true, leadTimeDays: true, depositPercent: true, automationMode: true },
      }),
      prisma.order.count({ where: openFilter }),
      prisma.order.findMany({
        where: openFilter,
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, orderNumber: true, status: true },
      }),
      prisma.invoice.aggregate({
        where: { supplierId, status: { not: "PAID" } },
        _sum: { amount: true, amountPaid: true },
      }),
      prisma.invoice.aggregate({
        where: { supplierId, status: { not: "PAID" }, dueDate: { lt: new Date() } },
        _sum: { amount: true, amountPaid: true },
      }),
      prisma.invoice.findMany({
        where: { supplierId, status: { not: "PAID" } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: 12,
        select: { id: true, invoiceNumber: true, amount: true, amountPaid: true, status: true, dueDate: true },
      }),
    ]);
    supplier = s
      ? { ...s, paymentModel: paymentModel({ paymentTerms: s.paymentTerms, depositPercent: s.depositPercent }) }
      : null;
    const bal = (a: { _sum: { amount: unknown; amountPaid: unknown } }) =>
      Math.max(0, Number(a._sum.amount ?? 0) - Number(a._sum.amountPaid ?? 0));
    const nowMs = Date.now();
    context = {
      openPOs,
      unpaidTotal: bal(unpaid),
      overdueTotal: bal(overdue),
      recentPOs: recentPOs.map((o) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status })),
      unpaidInvoices: unpaidList.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        balance: Math.max(0, Number(i.amount) - Number(i.amountPaid ?? 0)),
        status: i.status,
        dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
        overdue: !!i.dueDate && i.dueDate.getTime() < nowMs,
      })),
    };
  }

  // 24h free-reply window = the supplier messaged us within the last 24h.
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const windowOpen =
    !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < 24 * 60 * 60 * 1000;

  // Cold sends are workable when the approved new-order prompt template is
  // configured: "Create & send" outside the window sends the template prompt,
  // and the PO block follows automatically when the supplier's reply reopens
  // the window (sendPendingPurchaseOrders on the webhook). Lets the UI keep
  // the button enabled instead of dead-ending into the manual flow.
  const canColdPrompt = !!process.env.PROCUREMENT_PO_PROMPT_TEMPLATE?.trim();

  // Surface the supplier-chat agent's latest open proposal: only when the most
  // recent message WE sent was an agent escalation (a holding reply with a
  // structured proposal) and the supplier hasn't been answered by a human since.
  // That's the "AI proposes / human approves" handoff — the human sees the
  // concrete suggested PO edit and acts on it (the agent never applies it).
  let agentProposal: {
    messageId: string;
    orderId: string | null;
    intent: string;
    escalationReason: string;
    insight?: string;
    paymentModel?: string;
    popDeliveryCritical?: boolean;
    poAction: {
      type: string;
      poItemId: string | null;
      itemName: string | null;
      newQuantity: number | null;
      note: string | null;
    } | null;
    // A supplier-sent revised invoice: the concrete amount/number change to approve.
    invoiceAction: {
      invoiceId: string;
      invoiceNumber: string;
      orderNumber: string;
      fromAmount: number;
      toAmount: number | null;
      fromNumber: string;
      toNumber: string | null;
    } | null;
    at: string;
  } | null = null;
  const lastOutbound = await prisma.whatsAppMessage.findFirst({
    where: { ...counter, direction: "outbound" },
    orderBy: { timestamp: "desc" },
    select: { id: true, raw: true, timestamp: true },
  });
  const raw = (lastOutbound?.raw ?? null) as Record<string, unknown> | null;
  // Human takeover: if the last outbound was typed by a human (no system marker) and is
  // recent, the agent is standing down — you're handling this thread.
  const HUMAN_TAKEOVER_MS = (Number(process.env.PROCUREMENT_HUMAN_TAKEOVER_HOURS) || 6) * 60 * 60 * 1000;
  const lastOutByHuman =
    !raw ||
    (!raw.agent && !raw.invoiceRequestFor && !raw.receivingChaseFor && !raw.poSentFor && !raw.execBriefDate && !raw.soaHandoffFor && !raw.promiseChaseFor);
  const humanHandling =
    !!lastOutbound && lastOutByHuman && Date.now() - +new Date(lastOutbound.timestamp) < HUMAN_TAKEOVER_MS;
  // raw.proposalResolved is stamped when a human applies the proposal — once
  // resolved, stop surfacing the banner even though it's still the last message.
  if (raw && raw.escalated === true && raw.proposalResolved !== true && raw.proposal && typeof raw.proposal === "object") {
    const p = raw.proposal as Record<string, unknown>;
    const pa = (p.poAction ?? null) as Record<string, unknown> | null;
    const ia = (p.invoiceAction ?? null) as Record<string, unknown> | null;
    agentProposal = {
      messageId: lastOutbound!.id,
      orderId: typeof p.orderId === "string" ? p.orderId : null,
      intent: String(p.intent ?? "unclear"),
      escalationReason: String(p.escalationReason ?? "guardrail"),
      insight: typeof p.insight === "string" && p.insight.trim() ? p.insight.trim() : undefined,
      paymentModel: typeof p.paymentModel === "string" ? p.paymentModel : undefined,
      popDeliveryCritical: typeof p.popDeliveryCritical === "boolean" ? p.popDeliveryCritical : undefined,
      poAction: pa
        ? {
            type: String(pa.type ?? ""),
            poItemId: typeof pa.poItemId === "string" ? pa.poItemId : null,
            itemName: typeof pa.itemName === "string" ? pa.itemName : null,
            newQuantity: typeof pa.newQuantity === "number" ? pa.newQuantity : null,
            note: typeof pa.note === "string" ? pa.note : null,
          }
        : null,
      invoiceAction:
        ia && typeof ia.invoiceId === "string"
          ? {
              invoiceId: ia.invoiceId,
              invoiceNumber: String(ia.invoiceNumber ?? ""),
              orderNumber: String(ia.orderNumber ?? ""),
              fromAmount: typeof ia.fromAmount === "number" ? ia.fromAmount : 0,
              toAmount: typeof ia.toAmount === "number" ? ia.toAmount : null,
              fromNumber: String(ia.fromNumber ?? ""),
              toNumber: typeof ia.toNumber === "string" ? ia.toNumber : null,
            }
          : null,
      at: lastOutbound!.timestamp.toISOString(),
    };
  }

  // A DRAFT re-source PO the agent opened to an alternative supplier after this
  // supplier said an item was OOS (internal — never mentioned to the supplier).
  let agentReSource: { orderId: string | null; supplierName: string; orderNumber: string; qty: number; unit: string; existing: boolean } | null = null;
  if (raw && raw.reSource && typeof raw.reSource === "object") {
    const r = raw.reSource as Record<string, unknown>;
    agentReSource = {
      orderId: typeof r.orderId === "string" ? r.orderId : null,
      supplierName: String(r.supplierName ?? ""),
      orderNumber: String(r.orderNumber ?? ""),
      qty: typeof r.qty === "number" ? r.qty : 0,
      unit: typeof r.unit === "string" ? r.unit : "",
      existing: r.existing === true,
    };
  }

  return NextResponse.json({ key, supplierId, supplier, context, windowOpen, canColdPrompt, humanHandling, messages, agentProposal, agentReSource });
}
