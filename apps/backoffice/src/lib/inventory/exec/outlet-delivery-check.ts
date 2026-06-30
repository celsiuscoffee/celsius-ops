/**
 * Outlet delivery confirmation — ask BEFORE chasing the supplier.
 *
 * A PO's promised delivery date passed with no GRN. That looks like a late/missing
 * delivery, but it's just as often an OPS gap: the goods DID arrive, the outlet just
 * never recorded receiving. Chasing the supplier in that case is wrong and embarrassing.
 *
 * So before `chaseMissedPromises` (intent-responder) messages the supplier, it asks the
 * on-shift OUTLET TEAM "did this order arrive?" and only chases the supplier once the
 * outlet confirms it did NOT arrive — or the outlet doesn't answer within a grace window
 * (so a silent outlet never blocks the chase forever).
 *
 * Mechanics (no schema change — rides the established WhatsAppMessage.raw markers):
 *  - ASK: deliver the question to each on-shift staff via the approved ops template
 *    (sendOpsDigest — it reaches them OUTSIDE the 24h window, unlike free-form text),
 *    then stamp ONE marker onto the first delivered message:
 *      raw.outletCheckKind = "ask", raw.outletDeliveryCheckFor = orderId,
 *      raw.outletCheckPhones = [last9 of every recipient], raw.askedAt.
 *  - REPLY: the webhook calls handleOutletDeliveryReply on every inbound. A yes/no from a
 *    phone we asked is matched to its marker (by phone, the way the ops acks correlate) and
 *    stamps raw.outletDeliveryResult = "arrived" | "not_arrived".
 *  - On "arrived" we DON'T chase the supplier — the existing receiving-requester keeps
 *    nudging staff to record the GRN; we never auto-create a receiving from a text reply.
 *
 * Gated by PROCUREMENT_OUTLET_CONFIRM_ENABLED so it can roll out independently; off → the
 * chaser behaves exactly as before.
 */
import { prisma } from "@/lib/prisma";
import { resolveOutletTeam } from "@/lib/ops-pulse/router";
import { sendOpsDigest } from "@/lib/ops-pulse/sender";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

const HOUR = 60 * 60 * 1000;
const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");
const last9 = (s: string | null | undefined) => {
  const d = digits(s);
  return d.length >= 8 ? d.slice(-9) : "";
};

export function outletConfirmEnabled(): boolean {
  return process.env.PROCUREMENT_OUTLET_CONFIRM_ENABLED === "true";
}

function graceMs(): number {
  const h = Number(process.env.PROCUREMENT_OUTLET_CONFIRM_GRACE_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 6) * HOUR;
}

export type OutletDeliveryState = "unasked" | "pending" | "arrived" | "not_arrived" | "stale";

/** Read the outlet-confirm state for a PO from its stamped marker (one marker per PO). */
export async function readOutletDeliveryState(orderId: string): Promise<OutletDeliveryState> {
  const markers = await prisma.whatsAppMessage.findMany({
    where: { direction: "outbound", raw: { path: ["outletDeliveryCheckFor"], equals: orderId } },
    select: { raw: true, timestamp: true },
    orderBy: { timestamp: "asc" },
  });
  if (markers.length === 0) return "unasked";
  let arrived = false;
  let notArrived = false;
  let earliestAsk = Number.POSITIVE_INFINITY;
  for (const m of markers) {
    const raw = (m.raw && typeof m.raw === "object" ? (m.raw as Record<string, unknown>) : {}) as Record<string, unknown>;
    if (raw.outletDeliveryResult === "arrived") arrived = true;
    if (raw.outletDeliveryResult === "not_arrived") notArrived = true;
    const asked = typeof raw.askedAt === "string" ? +new Date(raw.askedAt) : +new Date(m.timestamp);
    if (Number.isFinite(asked) && asked < earliestAsk) earliestAsk = asked;
  }
  if (arrived) return "arrived"; // a confirmed "yes it came" wins over a "no" from someone who didn't see it
  if (notArrived) return "not_arrived";
  if (Number.isFinite(earliestAsk) && Date.now() - earliestAsk > graceMs()) return "stale";
  return "pending";
}

export type AskResult = "asked" | "no-team" | "send-failed";

/**
 * Ask the on-shift outlet team whether this PO's delivery arrived. Returns "asked" when a
 * marker was stamped (caller should wait), or "no-team"/"send-failed" when we couldn't reach
 * anyone (caller falls back to the normal supplier chase rather than blocking).
 */
export async function askOutletIfArrived(order: {
  id: string;
  orderNumber: string;
  outletId: string;
  supplierName: string;
  deliveryDate: Date | null;
}): Promise<AskResult> {
  const team = await resolveOutletTeam(order.outletId, new Date());
  const phones = Array.from(new Set(team.map((m) => digits(m.phone)).filter((p) => p.length >= 8)));
  if (phones.length === 0) return "no-team";

  const when = order.deliveryDate ? new Date(order.deliveryDate).toISOString().slice(0, 10) : "earlier";
  const headline = `Did ${order.supplierName}'s delivery for ${order.orderNumber} (expected ${when}) arrive?`;
  const line = "Reply YES if it came in (then please record receiving in the app), or NO if it hasn't — we'll follow up with the supplier.";
  const phones9 = phones.map((p) => last9(p)).filter(Boolean);

  let stamped = false;
  for (const phone of phones) {
    const res = await sendOpsDigest(phone, headline, [line]).catch(() => null);
    // Stamp the marker onto the FIRST delivered message — it carries every recipient's phone
    // so any of them can answer, and is the single source of truth for this PO's state.
    if (!stamped && res?.ok && res.messageId) {
      const msg = await prisma.whatsAppMessage.findFirst({
        where: { waMessageId: res.messageId },
        select: { id: true, raw: true },
      });
      if (msg) {
        const raw = (msg.raw && typeof msg.raw === "object" ? (msg.raw as Record<string, unknown>) : {}) as Record<string, unknown>;
        await prisma.whatsAppMessage.update({
          where: { id: msg.id },
          data: {
            raw: {
              ...raw,
              outletCheckKind: "ask",
              outletDeliveryCheckFor: order.id,
              outletCheckPhones: phones9,
              askedAt: new Date().toISOString(),
            },
          },
        });
        stamped = true;
      }
    }
  }
  if (!stamped) return "send-failed"; // nothing delivered → don't block the chase
  console.log(`[outlet-confirm] asked outlet team (${phones.length}) about ${order.orderNumber}`);
  return "asked";
}

/** "yes it came" vs "no/not yet" vs ambiguous. Negation dominates ("belum sampai" = no). */
function interpretArrival(text: string): "arrived" | "not_arrived" | null {
  const t = text.toLowerCase();
  const NEG = /\b(not|no|nope|belum|tak|tdk|tiada|takde|tada|haven'?t|hasn'?t|didn'?t|never|missing)\b|x\s*sampai|xsampai/;
  const POS = /\b(yes|yep|ya|sudah|sampai|arrive[ds]?|received?|terima|delivered|masuk)\b/;
  const neg = NEG.test(t);
  const pos = POS.test(t);
  if (neg) return "not_arrived"; // negation wins even if "sampai" appears ("tak sampai")
  if (pos) return "arrived";
  return null;
}

/**
 * Inbound from an outlet staff member. If it's a yes/no answer to a delivery-check we sent
 * THEM, stamp the result on the marker and ack. Returns null for anything else (cheap exit
 * for non-answers — the regex gate runs before any DB work). Never throws — caller logs.
 */
export async function handleOutletDeliveryReply(
  from: string,
  text: string,
): Promise<{ orderId: string; result: "arrived" | "not_arrived" } | null> {
  const result = interpretArrival(text || "");
  if (!from || !result) return null;

  const since = new Date(Date.now() - 3 * 24 * HOUR);
  const markers = await prisma.whatsAppMessage.findMany({
    where: { direction: "outbound", raw: { path: ["outletCheckKind"], equals: "ask" }, timestamp: { gte: since } },
    select: { id: true, raw: true },
    orderBy: { timestamp: "desc" },
    take: 100,
  });
  const f9 = last9(from);
  if (!f9) return null;
  const match = markers.find((m) => {
    const raw = (m.raw && typeof m.raw === "object" ? (m.raw as Record<string, unknown>) : {}) as Record<string, unknown>;
    if (raw.outletDeliveryResult) return false; // already answered
    const phones = Array.isArray(raw.outletCheckPhones) ? (raw.outletCheckPhones as unknown[]).map(String) : [];
    return phones.includes(f9);
  });
  if (!match) return null;

  const raw = (match.raw && typeof match.raw === "object" ? (match.raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const orderId = String(raw.outletDeliveryCheckFor ?? "");
  if (!orderId) return null;

  await prisma.whatsAppMessage.update({
    where: { id: match.id },
    data: { raw: { ...raw, outletDeliveryResult: result, outletCheckResolvedAt: new Date().toISOString(), outletCheckResolvedFrom: f9 } },
  });

  // The outlet just messaged us, so the 24h window is open — a free-form ack delivers.
  const ack =
    result === "arrived"
      ? "👍 Thanks! Please record the receiving in the app so stock updates — we won't chase the supplier."
      : "Thanks for confirming — we'll follow up with the supplier on the ETA. 🙏";
  const res = await sendWhatsAppText(digits(from), ack).catch(() => null);
  if (res?.messageId) {
    await recordOutboundMessage({
      waMessageId: res.messageId,
      fromNumber: "",
      toNumber: digits(from),
      type: "text",
      body: ack,
      supplierId: null,
      status: res.ok ? "sent" : "failed",
      raw: { kind: "outlet_check_ack", outletDeliveryAckFor: orderId, result },
    }).catch(() => {});
  }
  console.log(`[outlet-confirm] reply from ${f9} → ${result} (order ${orderId})`);
  return { orderId, result };
}
