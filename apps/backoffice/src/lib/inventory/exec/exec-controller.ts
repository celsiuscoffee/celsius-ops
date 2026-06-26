/**
 * Procurement Exec — the accountability loop (Inc 1: the spine).
 * See docs/design/procurement-exec-agent.md.
 *
 * The supplier-chat agent is the mouth; this is the brain. Inc 1 catches the gaps
 * that NOTHING currently tracks — the ones that quietly rot and become a stockout:
 *   - UNSENT RE-SOURCE: the agent opened a cover PO to an alternative supplier when
 *     a supplier was OOS, but it's still sitting DRAFT — the gap isn't actually
 *     being filled until someone sends it.
 *   - OVERDUE GRN: a PO past its delivery date with no receiving recorded — goods
 *     may be in but unbooked (breaks stock + invoice matching), or never arrived.
 * It then sends ONE concise WhatsApp brief/day to PROCUREMENT_EXEC_NOTIFY_TO so a
 * human sees what needs action — the exec reporting, not a silent dashboard.
 *
 * Decoupled by design: reads existing data, touches no agent code, no schema, no
 * migration → it doesn't collide with the chat-agent rewrites. Gated by
 * PROCUREMENT_AGENT_ENABLED. De-duped (one brief/day) via raw.execBriefDate.
 * Never throws. Later increments add OOS-risk + overstock + COGS + finance handoff.
 */
import type { OrderStatus } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";

export const EXEC_VERSION = "procurement-exec-v1";

// Mirrors RESOURCE_NOTE_PREFIX in resource-po.ts (kept local so the exec stays
// decoupled from the agent module).
const RESOURCE_NOTE_PREFIX = "Auto re-source by supplier-chat agent";

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");
const DAY = 24 * 60 * 60 * 1000;

const AWAITING_STATUSES: OrderStatus[] = ["SENT", "CONFIRMED", "AWAITING_DELIVERY"];

function enabled(): boolean {
  return process.env.PROCUREMENT_AGENT_ENABLED === "true";
}

function todayMyt(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface ExecRunSummary {
  unsentReSource: number;
  overdueGrn: number;
  briefSent: boolean;
  skipped?: string;
}

export async function runProcurementExec(): Promise<ExecRunSummary> {
  if (!enabled()) return { unsentReSource: 0, overdueGrn: 0, briefSent: false, skipped: "disabled" };

  const now = new Date();
  const agingBefore = new Date(now.getTime() - DAY); // a re-source draft older than 1 day = unsent

  // ── Gap 1: re-source cover POs the agent opened but that are still unsent ──
  const unsent = await prisma.order.findMany({
    where: {
      orderType: "PURCHASE_ORDER",
      status: "DRAFT",
      notes: { startsWith: RESOURCE_NOTE_PREFIX },
      createdAt: { lt: agingBefore },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      orderNumber: true,
      totalAmount: true,
      createdAt: true,
      supplier: { select: { name: true } },
      outlet: { select: { name: true } },
    },
  });

  // ── Gap 2: POs past their delivery date with no receiving recorded ──
  const overdue = await prisma.order.findMany({
    where: {
      orderType: "PURCHASE_ORDER",
      status: { in: AWAITING_STATUSES },
      deliveryDate: { lt: now },
      receivings: { none: {} },
    },
    orderBy: { deliveryDate: "asc" },
    take: 50,
    select: {
      orderNumber: true,
      deliveryDate: true,
      supplier: { select: { name: true } },
      outlet: { select: { name: true } },
    },
  });

  const summary: ExecRunSummary = {
    unsentReSource: unsent.length,
    overdueGrn: overdue.length,
    briefSent: false,
  };

  // Nothing to report → don't message.
  if (unsent.length === 0 && overdue.length === 0) return summary;

  const dest = digits(process.env.PROCUREMENT_EXEC_NOTIFY_TO);
  if (dest.length < 8) {
    console.log(
      `[procurement-exec] gaps: unsentReSource=${unsent.length} overdueGrn=${overdue.length} ` +
        `(no PROCUREMENT_EXEC_NOTIFY_TO set — not sending a brief)`,
    );
    return summary;
  }

  const today = todayMyt();
  // One brief per day.
  const alreadyToday = await prisma.whatsAppMessage.findFirst({
    where: { direction: "outbound", raw: { path: ["execBriefDate"], equals: today } },
    select: { id: true },
  });
  if (alreadyToday) {
    summary.skipped = "brief-already-sent-today";
    return summary;
  }

  // 24h window with the recipient (internal staff). Free text in-window; outside it
  // we skip + log — a business-initiated template is the production path.
  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where: { fromNumber: dest, direction: "inbound" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  const windowOpen = !!lastInbound && Date.now() - +new Date(lastInbound.timestamp) < DAY;

  const brief = buildBrief(unsent, overdue);
  if (!windowOpen) {
    console.log(`[procurement-exec] brief skipped — 24h window closed for ${dest} (needs a template)\n${brief}`);
    summary.skipped = "window-closed";
    return summary;
  }

  const res = await sendWhatsAppText(dest, brief);
  await recordOutboundMessage({
    waMessageId: res.messageId,
    fromNumber: "",
    toNumber: dest,
    type: "text",
    body: brief,
    supplierId: null,
    status: res.ok ? "sent" : "failed",
    raw: {
      agent: EXEC_VERSION,
      execBriefDate: today,
      unsentReSource: unsent.length,
      overdueGrn: overdue.length,
      ok: res.ok,
      error: res.error ?? null,
    },
  });
  summary.briefSent = res.ok;
  console.log(
    `[procurement-exec] brief sent=${res.ok} unsentReSource=${unsent.length} overdueGrn=${overdue.length}`,
  );
  return summary;
}

type UnsentRow = {
  orderNumber: string;
  totalAmount: unknown;
  supplier: { name: string } | null;
  outlet: { name: string } | null;
};
type OverdueRow = {
  orderNumber: string;
  deliveryDate: Date | null;
  supplier: { name: string } | null;
  outlet: { name: string } | null;
};

function buildBrief(unsent: UnsentRow[], overdue: OverdueRow[]): string {
  const lines: string[] = ["🧮 *Procurement status*"];
  if (unsent.length) {
    lines.push(`\n⚠️ ${unsent.length} re-source order${unsent.length > 1 ? "s" : ""} still unsent (cover for OOS):`);
    for (const o of unsent.slice(0, 3)) {
      lines.push(`• ${o.orderNumber} → ${o.supplier?.name ?? "?"} (${o.outlet?.name ?? "?"}) RM${Number(o.totalAmount).toFixed(0)} — review + send`);
    }
    if (unsent.length > 3) lines.push(`• …+${unsent.length - 3} more`);
  }
  if (overdue.length) {
    lines.push(`\n📦 ${overdue.length} PO${overdue.length > 1 ? "s" : ""} overdue for receiving:`);
    for (const o of overdue.slice(0, 3)) {
      const d = o.deliveryDate ? new Date(o.deliveryDate).toISOString().slice(0, 10) : "?";
      lines.push(`• ${o.orderNumber} — ${o.supplier?.name ?? "?"} (${o.outlet?.name ?? "?"}), due ${d} — confirm GRN`);
    }
    if (overdue.length > 3) lines.push(`• …+${overdue.length - 3} more`);
  }
  return lines.join("\n");
}
