import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";

// Human applies the supplier-chat agent's held proposal to the PO — the
// "AI proposes / human approves" handoff, now one click from the chat instead
// of a hunt through Purchase Orders.
//
// SAFE by construction:
//  - Only the two low-risk, internal edits are appliable here: remove_item and
//    reduce_qty. Substitution / cancellation stay on the PO page (they carry
//    pricing or external-effect decisions a human should see in full).
//  - Never touches a COMPLETED / CANCELLED PO.
//  - Stamps the originating message raw.proposalResolved so the banner clears
//    and the same proposal can't be applied twice.

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key } = await params;
  const body = await req.json().catch(() => ({}));
  const { messageId, orderId, poItemId, action, newQuantity } = body as {
    messageId?: string;
    orderId?: string;
    poItemId?: string;
    action?: string;
    newQuantity?: number;
  };

  if (!messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  // The message must be this thread's escalation, not yet resolved — prevents
  // double-apply and cross-thread tampering with a stale messageId.
  const message = await prisma.whatsAppMessage.findFirst({
    where: { id: messageId, OR: [{ fromNumber: key }, { toNumber: key }], direction: "outbound" },
    select: { id: true, raw: true },
  });
  if (!message) return NextResponse.json({ error: "Proposal message not found" }, { status: 404 });
  const raw = (message.raw ?? {}) as Record<string, unknown>;
  if (raw.proposalResolved === true) {
    return NextResponse.json({ error: "This proposal was already resolved." }, { status: 409 });
  }

  // Dismiss = the human handled it out-of-band (paid the invoice, replied themselves, no
  // PO change needed). Just clear the banner. This is the resolution for escalations with
  // no auto-appliable PO action — payment chase, SOA query, complaint, lead-time, etc.
  if (action === "dismiss") {
    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: { raw: { ...raw, proposalResolved: true, dismissed: true, resolvedById: caller.id, resolvedAt: new Date().toISOString() } },
    });
    return NextResponse.json({ ok: true, dismissed: true });
  }

  // Apply a supplier-sent invoice REVISION the agent proposed (amount and/or number).
  // SAFE by construction: the values come from the agent-stamped proposal on THIS message
  // (never the request body), and a PAID / part-paid invoice is refused outright — money has
  // moved, so a human edits it manually. Only amount + invoiceNumber change; status/payment never.
  if (action === "apply_invoice_revision") {
    const proposal = (raw.proposal ?? {}) as Record<string, unknown>;
    const invoiceAction = (proposal.invoiceAction ?? null) as
      | { invoiceId?: string; invoiceNumber?: string; toAmount?: number | null; toNumber?: string | null }
      | null;
    if (!invoiceAction?.invoiceId) {
      return NextResponse.json({ error: "No invoice revision on this proposal." }, { status: 400 });
    }
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceAction.invoiceId },
      select: { id: true, invoiceNumber: true, amount: true, status: true, amountPaid: true },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (invoice.status === "PAID" || Number(invoice.amountPaid ?? 0) > 0) {
      return NextResponse.json(
        { error: `Invoice ${invoice.invoiceNumber} is already paid/part-paid — edit it manually.` },
        { status: 400 },
      );
    }
    const data: { amount?: number; invoiceNumber?: string } = {};
    if (typeof invoiceAction.toAmount === "number" && invoiceAction.toAmount > 0) data.amount = invoiceAction.toAmount;
    if (typeof invoiceAction.toNumber === "string" && invoiceAction.toNumber.trim()) {
      data.invoiceNumber = invoiceAction.toNumber.trim().slice(0, 64);
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to apply (no new amount or number)." }, { status: 400 });
    }
    try {
      await prisma.invoice.update({ where: { id: invoice.id }, data });
    } catch (e) {
      // e.g. a unique invoiceNumber collision — surface it rather than 500.
      return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 400 });
    }
    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        raw: { ...raw, proposalResolved: true, invoiceRevisionApplied: true, resolvedById: caller.id, resolvedAt: new Date().toISOString() },
      },
    });
    return NextResponse.json({ ok: true, action, invoiceId: invoice.id, applied: data });
  }

  // ── Apply the STAMPED PO actions ──────────────────────────────────────────
  // Everything applied comes from the agent-stamped proposal on THIS message —
  // never the request body. (The body used to be authoritative: any unresolved
  // messageId authorized editing arbitrary lines of any open order.) The body's
  // `action` is only the mode selector; legacy callers passing a specific
  // action/poItemId get exactly that stamped action, new callers pass
  // action:"apply" and get every stamped line — a multi-item shortfall used to
  // apply line 1 and silently drop lines 2..n.
  const proposal = (raw.proposal ?? {}) as Record<string, unknown>;
  const stampedOrderId = typeof proposal.orderId === "string" ? proposal.orderId : null;
  type StampedAction = { type?: string; poItemId?: string | null; itemName?: string | null; newQuantity?: number | null };
  const stamped: StampedAction[] = Array.isArray(proposal.poActions)
    ? (proposal.poActions as StampedAction[])
    : proposal.poAction
      ? [proposal.poAction as StampedAction]
      : [];
  // Only the two low-risk internal edits are appliable from chat.
  let toApply = stamped.filter((a) => a.type === "remove_item" || a.type === "reduce_qty");
  if (action === "remove_item" || action === "reduce_qty") {
    // Legacy single-action call: apply just the stamped action it names.
    toApply = toApply.filter((a) => a.type === action && (!poItemId || a.poItemId === poItemId));
  } else if (action !== "apply") {
    return NextResponse.json(
      { error: "Only remove_item and reduce_qty can be applied from chat. Open the PO for other changes." },
      { status: 400 },
    );
  }
  if (!stampedOrderId || (orderId && orderId !== stampedOrderId)) {
    return NextResponse.json({ error: "Proposal has no matching order" }, { status: 400 });
  }
  if (toApply.length === 0) {
    return NextResponse.json({ error: "No appliable PO action on this proposal." }, { status: 400 });
  }

  const results: Array<{ item: string; action: string; ok: boolean; error?: string }> = [];
  for (const a of toApply) {
    const label = a.itemName ?? a.poItemId ?? "?";
    if (!a.poItemId) {
      results.push({ item: label, action: a.type!, ok: false, error: "no PO line id" });
      continue;
    }
    const item = await prisma.orderItem.findFirst({
      where: { id: a.poItemId, orderId: stampedOrderId },
      select: { id: true, unitPrice: true, quantity: true, order: { select: { status: true, orderNumber: true } } },
    });
    if (!item) {
      results.push({ item: label, action: a.type!, ok: false, error: "PO line not found (already edited?)" });
      continue;
    }
    if (item.order.status === "COMPLETED" || item.order.status === "CANCELLED") {
      results.push({ item: label, action: a.type!, ok: false, error: `PO is ${item.order.status.toLowerCase()}` });
      continue;
    }
    if (a.type === "reduce_qty") {
      const newQty = typeof a.newQuantity === "number" ? a.newQuantity : (newQuantity as number | undefined);
      if (typeof newQty !== "number" || newQty <= 0) {
        results.push({ item: label, action: a.type, ok: false, error: "no valid new quantity" });
        continue;
      }
      // A reduce must LOWER the line — an escalated proposal can carry a model
      // misread ("ada 50 je" read as qty 50 on a 5-unit line); never apply blind.
      if (newQty >= Number(item.quantity)) {
        results.push({ item: label, action: a.type, ok: false, error: `qty ${newQty} doesn't reduce current ${Number(item.quantity)} — misread?` });
        continue;
      }
      await prisma.orderItem.update({
        where: { id: item.id },
        data: { quantity: newQty, totalPrice: Number(item.unitPrice) * newQty },
      });
      results.push({ item: label, action: a.type, ok: true });
    } else {
      await prisma.orderItem.delete({ where: { id: item.id } });
      results.push({ item: label, action: a.type!, ok: true });
    }
  }

  const appliedCount = results.filter((r) => r.ok).length;
  if (appliedCount === 0) {
    return NextResponse.json(
      { error: `Nothing applied: ${results.map((r) => `${r.item} — ${r.error}`).join("; ")}` },
      { status: 400 },
    );
  }

  // Recompute the order total from the remaining lines (+ keep delivery charge).
  const [remaining, order] = await Promise.all([
    prisma.orderItem.findMany({ where: { orderId: stampedOrderId }, select: { totalPrice: true } }),
    prisma.order.findUnique({ where: { id: stampedOrderId }, select: { deliveryCharge: true } }),
  ]);
  const itemsTotal = remaining.reduce((s, i) => s + Number(i.totalPrice), 0);
  const dc = order?.deliveryCharge ? Number(order.deliveryCharge) : 0;
  await prisma.order.update({ where: { id: stampedOrderId }, data: { totalAmount: itemsTotal + dc } });

  // Stamp the proposal resolved so the banner clears and it can't re-apply.
  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      raw: {
        ...raw,
        proposalResolved: true,
        resolvedById: caller.id,
        resolvedAt: new Date().toISOString(),
        applyResults: results,
      },
    },
  });

  return NextResponse.json({ ok: true, orderId: stampedOrderId, applied: appliedCount, results });
}
