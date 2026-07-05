/**
 * Human approval of a held proposal (closes the ASSIST loop).
 *
 * When the agent escalates it stores a structured proposal (raw.proposal) and posts a
 * holding line. Until now the ONLY way to apply it was the inbox "Apply" button — and
 * that covers only remove/reduce, so a substitution approved in chat ("boleh") went
 * nowhere. This makes a plain affirmative reply from a human DO the thing:
 *  - reduce_qty / remove_item → apply (re-source the removed line)
 *  - substitute_item → swap to the supplier's offered replacement (resolved from their
 *    price list); if it isn't priced there, remove + re-source so the need is still met
 *  - cancel_order → not auto-applied (too consequential — left for the PO page)
 *
 * Triggered from the human-send route AFTER the message is recorded. Best-effort: only
 * fires on a short affirmative AND a pending unresolved proposal that is BOTH the
 * newest real outbound on the thread AND ≤48h old — if anything was said since (or the
 * proposal went stale), the affirmative is ambiguous and the inbox Apply flow is the
 * only path. Stamps raw.proposalResolved so it can't double-apply. Never throws.
 */
import { prisma } from "@/lib/prisma";
import { createReSourcePO } from "@/lib/inventory/agents/resource-po";

// Whole message is essentially just "yes" (EN/Malay) — strict, so questions like
// "boleh tak hantar esok?" don't match.
const APPROVE_RX =
  /^\s*(boleh|ok(ay)?( la)?|ok boleh|yes( please)?|ya|yep|yup|proceed|teruskan|terus(kan)?|setuju|confirm(ed)?|go ?ahead|sila|baik|approved?|noted ok)\s*[.!,👍🙏🆗✅]*\s*$/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type ProposalAction = { type: string; poItemId: string | null; newQuantity: number | null; note: string | null };
type Proposal = { orderId: string | null; poAction: ProposalAction | null };

export interface ApprovalResult {
  applied: string; // machine tag: reduce_qty | remove_item | substitute_item | cancel_pending | none
  detail: string; // human-readable
}

export async function tryApplyHumanApproval(
  key: string,
  text: string,
  callerId: string,
): Promise<ApprovalResult | null> {
  try {
    if (!APPROVE_RX.test(text)) return null;

    // The "ok" only applies a proposal when the context is unambiguous:
    //  1. the NEWEST real outbound on the thread IS the pending proposal (internal
    //     "PO sent" notes don't count as conversation) — if the agent or a human has
    //     said anything since, the affirmative may be about that instead, so we
    //     refuse and leave the proposal for the inbox banner / Apply button;
    //  2. the proposal is fresh (≤48h) — a stale "ok" days later must never
    //     silently mutate a PO.
    const recent = await prisma.whatsAppMessage.findMany({
      where: { OR: [{ fromNumber: key }, { toNumber: key }], direction: "outbound" },
      orderBy: { timestamp: "desc" },
      take: 12,
      select: { id: true, raw: true, timestamp: true },
    });
    let msgId: string | null = null;
    let proposal: Proposal | null = null;
    let proposalAt: Date | null = null;
    for (const m of recent) {
      const raw = (m.raw ?? {}) as Record<string, unknown>;
      if (raw.poThreadNote) continue; // internal note, not part of the conversation
      const p = raw.proposal as Proposal | null;
      if (
        raw.proposalResolved !== true &&
        p &&
        typeof p === "object" &&
        p.poAction &&
        p.poAction.type &&
        p.poAction.type !== "none"
      ) {
        msgId = m.id;
        proposal = p;
        proposalAt = m.timestamp;
      }
      break; // only the newest real outbound counts — anything else is ambiguous
    }
    if (!msgId || !proposal?.poAction || !proposal.orderId) return null;
    if (!proposalAt || Date.now() - +new Date(proposalAt) > 48 * 60 * 60 * 1000) {
      console.warn(`[human-approval] ${key} affirmative ignored — pending proposal older than 48h, use the inbox Apply flow`);
      return null;
    }

    const pa = proposal.poAction;
    if (!pa.poItemId) return null;

    const item = await prisma.orderItem.findFirst({
      where: { id: pa.poItemId, orderId: proposal.orderId },
      select: {
        id: true,
        quantity: true,
        unitPrice: true,
        productId: true,
        productPackageId: true,
        product: { select: { name: true } },
        productPackage: { select: { conversionFactor: true } },
        order: { select: { status: true, outletId: true, supplierId: true } },
      },
    });
    if (!item) return null;
    if (item.order.status === "COMPLETED" || item.order.status === "CANCELLED") return null;

    const orderId = proposal.orderId;
    const baseQty = Number(item.quantity) * (item.productPackage ? Number(item.productPackage.conversionFactor) || 1 : 1);
    let result: ApprovalResult;

    if (pa.type === "reduce_qty" && typeof pa.newQuantity === "number" && pa.newQuantity > 0) {
      // A reduce must LOWER the line — same ceiling as the agent's own applyPoAction.
      // Escalated proposals can carry a model misread (e.g. "ada 50 je" read as qty 50
      // on a 5-unit line); a bare "ok" in chat must never apply that blind and raise
      // committed spend. Leave the proposal unresolved so the inbox still surfaces it.
      if (pa.newQuantity >= Number(item.quantity)) {
        console.warn(
          `[human-approval] refused reduce_qty ${pa.newQuantity} >= current ${Number(item.quantity)} (${item.product?.name}) — needs manual review`,
        );
        return null;
      }
      await prisma.orderItem.update({
        where: { id: item.id },
        data: { quantity: pa.newQuantity, totalPrice: Number(item.unitPrice) * pa.newQuantity },
      });
      result = { applied: "reduce_qty", detail: `${item.product?.name}: qty → ${pa.newQuantity}` };
    } else if (pa.type === "remove_item") {
      await prisma.orderItem.delete({ where: { id: item.id } });
      const rs = await reSource(item.productId, item.product?.name ?? "item", baseQty, item.order, callerId);
      result = { applied: "remove_item", detail: `removed ${item.product?.name}${rs ? ` · re-sourced (${rs})` : ""}` };
    } else if (pa.type === "substitute_item") {
      result = await applySubstitution(key, item, baseQty, orderId, callerId);
    } else if (pa.type === "cancel_order") {
      // Don't auto-cancel from a chat "boleh" — flag it, leave for the PO page.
      return { applied: "cancel_pending", detail: "cancellation approved — confirm on the PO page" };
    } else {
      return null;
    }

    await recomputeTotal(orderId);
    await prisma.whatsAppMessage.update({
      where: { id: msgId },
      data: {
        raw: {
          ...((recent.find((m) => m.id === msgId)?.raw as Record<string, unknown>) ?? {}),
          proposalResolved: true,
          resolvedById: callerId,
          resolvedVia: "human-approval-chat",
          resolvedAt: new Date().toISOString(),
          appliedOnApproval: result.applied,
        },
      },
    });
    console.log(`[human-approval] ${key} applied=${result.applied} — ${result.detail}`);
    return result;
  } catch (e) {
    console.warn("[human-approval] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Swap the OOS line to the supplier's offered replacement, resolved from their price list. */
async function applySubstitution(
  key: string,
  item: { id: string; quantity: unknown; productId: string; product: { name: string } | null; order: { outletId: string; supplierId: string | null } },
  baseQty: number,
  orderId: string,
  callerId: string,
): Promise<ApprovalResult> {
  const offer = await prisma.whatsAppMessage.findFirst({
    where: { fromNumber: key, direction: "inbound" },
    orderBy: { timestamp: "desc" },
    select: { body: true },
  });
  const offerText = (offer?.body ?? "").toLowerCase();
  const offerNorm = norm(offerText);

  const sps = item.order.supplierId
    ? await prisma.supplierProduct.findMany({
        where: { supplierId: item.order.supplierId, isActive: true, price: { gt: 0 }, product: { isActive: true } },
        select: {
          price: true,
          productPackageId: true,
          product: { select: { id: true, name: true } },
          productPackage: { select: { conversionFactor: true, packageLabel: true } },
        },
      })
    : [];
  // The replacement = a supplier product (not the OOS one) whose name appears in the offer.
  const repl =
    sps.find((sp) => sp.product.id !== item.productId && offerText.includes(sp.product.name.toLowerCase())) ||
    sps.find((sp) => sp.product.id !== item.productId && offerNorm.includes(norm(sp.product.name)));

  await prisma.orderItem.delete({ where: { id: item.id } });
  if (repl) {
    // Match the GOODS quantity, not the line count: the old line's package can differ
    // from the replacement's (5 × 1kg bags ≠ 5 × 500g packs). Convert the removed line
    // to base units, then into the replacement's package units, rounding up so we never
    // under-order the recipe need.
    const replConvRaw = repl.productPackage ? Number(repl.productPackage.conversionFactor) : 1;
    const replConv = replConvRaw > 0 ? replConvRaw : 1;
    const qty = Math.max(1, Math.ceil(baseQty / replConv));
    await prisma.orderItem.create({
      data: {
        orderId,
        productId: repl.product.id,
        productPackageId: repl.productPackageId,
        quantity: qty,
        unitPrice: Number(repl.price),
        totalPrice: Number(repl.price) * qty,
      },
    });
    const unit = repl.productPackage?.packageLabel ?? "unit";
    return { applied: "substitute_item", detail: `${item.product?.name} → ${repl.product.name} (${qty} ${unit})` };
  }
  // Couldn't price the replacement on this supplier → cover the need elsewhere.
  const rs = await reSource(item.productId, item.product?.name ?? "item", baseQty, item.order, callerId);
  return {
    applied: "substitute_item",
    detail: `removed ${item.product?.name} (replacement not in price list — add manually)${rs ? ` · re-sourced (${rs})` : ""}`,
  };
}

async function reSource(
  productId: string,
  productName: string,
  baseQty: number,
  order: { outletId: string; supplierId: string | null },
  callerId: string,
): Promise<string | null> {
  if (!order.supplierId || baseQty <= 0) return null;
  const sys = (await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } }))?.id ?? callerId;
  const rs = await createReSourcePO({
    productId,
    productName,
    baseQtyNeeded: baseQty,
    fromSupplierId: order.supplierId,
    fromSupplierName: "",
    outletId: order.outletId,
    systemUserId: sys,
  });
  return rs ? rs.orderNumber : null;
}

async function recomputeTotal(orderId: string): Promise<void> {
  const [remaining, order] = await Promise.all([
    prisma.orderItem.findMany({ where: { orderId }, select: { totalPrice: true } }),
    prisma.order.findUnique({ where: { id: orderId }, select: { deliveryCharge: true } }),
  ]);
  const itemsTotal = remaining.reduce((s, i) => s + Number(i.totalPrice), 0);
  const dc = order?.deliveryCharge ? Number(order.deliveryCharge) : 0;
  await prisma.order.update({ where: { id: orderId }, data: { totalAmount: itemsTotal + dc } });
}
