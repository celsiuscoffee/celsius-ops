// Ops message monitor — a flat, filterable feed over the shared WhatsAppMessage
// store (every system send lands there via recordOutboundMessage; every inbound
// via the webhook). The Inbox tab threads by person for replying; this is the
// oversight log: "what did the ops loop send, to whom, did it land?"
//
// Kind is read from raw.kind (the template name stamped at send time in
// sendProactive), mapped to a friendly bucket; older rows / manual replies fall
// back to body inference. Supplier-chat traffic (supplierId set) is its own kind
// and excluded by default — this is the staff/ops view, suppliers have their own.

import { prisma } from "@/lib/prisma";
import { canonicalPhone } from "@/lib/wa-messages";

export type OpsMsgKind =
  | "pulse"
  | "nudge"
  | "scoreboard"
  | "reminder"
  | "instruction"
  | "audit"
  | "reply"
  | "manual"
  | "supplier"
  | "other";

export interface OpsMessageView {
  id: string;
  direction: "in" | "out";
  kind: OpsMsgKind;
  name: string | null; // staff name resolved from the counterparty phone
  phone: string;
  body: string;
  status: string | null; // sent | failed | delivered | read | null
  type: string; // text | template | image | ...
  at: string; // ISO
}

export interface OpsMessageFilters {
  days?: number;
  kind?: OpsMsgKind | "all";
  status?: "all" | "sent" | "failed";
  direction?: "all" | "in" | "out";
  q?: string;
  includeSupplier?: boolean;
  limit?: number;
}

// Template name (raw.kind) → friendly bucket.
function kindFromTemplate(name: string): OpsMsgKind | null {
  const n = name.toLowerCase();
  if (n.includes("scoreboard")) return "scoreboard";
  if (n.includes("reminder")) return "reminder";
  if (n.includes("instruction")) return "instruction";
  if (n.includes("audit")) return "audit";
  if (n.includes("nudge")) return "nudge";
  if (n.includes("pulse")) return "pulse";
  return null;
}

// Fallback when raw.kind is absent (manual replies, pre-tagging rows).
function kindFromBody(body: string): OpsMsgKind {
  const b = body.trim().toLowerCase();
  if (b.startsWith("your scoreboard") || b.startsWith("outlet league") || b.startsWith("outlet scoreboard")) return "scoreboard";
  if (b.startsWith("reminder")) return "reminder";
  if (b.startsWith("instruction")) return "instruction";
  if (b.startsWith("audit") || b.includes("audits due")) return "audit";
  if (b.startsWith("ops pulse") || b.startsWith("daily ops pulse") || b.startsWith("ops escalation")) return "pulse";
  if (b.includes("clock in") || b.includes("clocked in") || b.includes("stock count") || b.includes("follow up with the team")) return "nudge";
  return "manual";
}

function classify(row: { direction: string; supplierId: string | null; body: string | null; raw: unknown }): OpsMsgKind {
  if (row.supplierId) return "supplier";
  if (row.direction === "inbound") return "reply";
  const tagged = (row.raw as { kind?: string } | null)?.kind;
  if (tagged) return kindFromTemplate(tagged) ?? "other";
  return kindFromBody(row.body ?? "");
}

export async function listOpsMessages(opts: OpsMessageFilters = {}): Promise<{
  messages: OpsMessageView[];
  summary: { total: number; sent: number; failed: number; inbound: number; byKind: Record<string, number> };
}> {
  const days = opts.days ?? 7;
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.whatsAppMessage.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
    take: 1000,
    select: { id: true, direction: true, fromNumber: true, toNumber: true, supplierId: true, type: true, body: true, status: true, raw: true, timestamp: true },
  });

  // Resolve staff names by canonical phone (small set).
  const users = await prisma.user.findMany({ where: { phone: { not: null } }, select: { name: true, fullName: true, phone: true } });
  const nameByCanon = new Map<string, string>();
  for (const u of users) if (u.phone) nameByCanon.set(canonicalPhone(u.phone), u.fullName || u.name);

  const q = (opts.q || "").trim().toLowerCase();
  const all: OpsMessageView[] = rows.map((r) => {
    const direction: "in" | "out" = r.direction === "inbound" ? "in" : "out";
    const counterparty = direction === "in" ? r.fromNumber : r.toNumber;
    return {
      id: r.id,
      direction,
      kind: classify(r),
      name: nameByCanon.get(canonicalPhone(counterparty)) ?? null,
      phone: counterparty,
      body: r.body ?? "",
      status: r.status,
      type: r.type,
      at: r.timestamp.toISOString(),
    };
  });

  // Summary over the full window (before view filters), excluding supplier unless asked.
  const scope = all.filter((m) => (opts.includeSupplier ? true : m.kind !== "supplier"));
  const summary = {
    total: scope.length,
    sent: scope.filter((m) => m.direction === "out" && m.status !== "failed").length,
    failed: scope.filter((m) => m.status === "failed").length,
    inbound: scope.filter((m) => m.direction === "in").length,
    byKind: scope.reduce<Record<string, number>>((acc, m) => ((acc[m.kind] = (acc[m.kind] ?? 0) + 1), acc), {}),
  };

  // Apply view filters.
  let messages = scope;
  if (opts.kind && opts.kind !== "all") messages = messages.filter((m) => m.kind === opts.kind);
  if (opts.direction && opts.direction !== "all") messages = messages.filter((m) => m.direction === opts.direction);
  if (opts.status && opts.status !== "all") {
    messages = messages.filter((m) => (opts.status === "failed" ? m.status === "failed" : m.direction === "out" && m.status !== "failed"));
  }
  if (q) messages = messages.filter((m) => m.body.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q) || m.phone.includes(q));

  return { messages: messages.slice(0, opts.limit ?? 300), summary };
}
