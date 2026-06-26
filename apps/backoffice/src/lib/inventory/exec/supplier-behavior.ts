/**
 * Supplier behaviour model (Inc 5) — learns each supplier's habits from their message
 * history so the exec can PREDICT, not just react:
 *   - reply speed  → chase a slow supplier sooner; don't nag a 2-minute one
 *   - lead time    → order → delivery; the realistic ETA + when a PO is genuinely late
 *   - doc timing   → when they upload the invoice / PoP after an order
 *   - reliability  → how often they go OOS → route critical items elsewhere
 *
 * Two sources, merged: a committed BASELINE mined from 17 historical WhatsApp chats
 * (supplier-behavior-seed.json) + LIVE WhatsAppMessage / Order data that takes over
 * once there's enough of it. Decoupled + read-only — no schema change, no agent edits.
 */
import { prisma } from "@/lib/prisma";
import seedFile from "./supplier-behavior-seed.json";

const OOS_RX = /takde|x ?ada|tak ?ada|habis|kosong|no stock|out of stock|\boos\b|sold out/i;
const DAY = 24 * 60 * 60 * 1000;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

type Baseline = {
  supplier: string;
  replyMedianMins: number | null;
  replySpeed: "fast" | "normal" | "slow";
  oosEvents: number;
  oosRatePct: number;
  reliability: "high" | "medium" | "low";
  docCount: number;
  docMedianMins: number | null;
  docPeakHour: number | null;
  activePeakHour: number | null;
  supMsgs: number;
  spanDays: number;
};
const SEED = (seedFile as { suppliers: Record<string, Baseline> }).suppliers;

export interface SupplierBehavior {
  name: string;
  replyMedianMins: number | null;
  replySpeed: "fast" | "normal" | "slow" | "unknown";
  leadTimeMedianDays: number | null;
  docMedianMins: number | null;
  oosRatePct: number | null;
  reliability: "high" | "medium" | "low" | "unknown";
  source: "live" | "baseline" | "blend" | "none";
  sampleMsgs: number;
}

/** Seed baseline for a supplier name (exact normalised, then either-way contains). */
export function behaviorBaseline(name: string): Baseline | null {
  const key = norm(name);
  if (!key) return null;
  if (SEED[key]) return SEED[key];
  for (const [k, v] of Object.entries(SEED)) {
    if (k.length >= 3 && (k.includes(key) || key.includes(k))) return v;
  }
  return null;
}

/** A tiny inline tag for briefs/lists, baseline-only (sync, no DB). "" when unknown. */
export function behaviorTag(name: string): string {
  const b = behaviorBaseline(name);
  if (!b) return "";
  const t: string[] = [];
  if (b.reliability === "low") t.push("⚠️ often OOS");
  if (b.replySpeed === "slow") t.push("🐢 slow reply");
  return t.length ? ` [${t.join(" · ")}]` : "";
}

/** Median lead time (PO sent → first receiving), in days, from live Order data. */
async function medianLeadDays(supplierId: string): Promise<number | null> {
  const orders = await prisma.order.findMany({
    where: { supplierId, orderType: "PURCHASE_ORDER", receivings: { some: {} } },
    select: { sentAt: true, createdAt: true, receivings: { orderBy: { receivedAt: "asc" }, take: 1, select: { receivedAt: true } } },
    take: 100,
  });
  const days: number[] = [];
  for (const o of orders) {
    const start = o.sentAt ?? o.createdAt;
    const recv = o.receivings[0]?.receivedAt;
    if (start && recv) {
      const d = (+new Date(recv) - +new Date(start)) / DAY;
      if (d >= 0 && d < 60) days.push(d);
    }
  }
  return days.length >= 3 ? median(days) : null;
}

/** The full model: live WhatsAppMessage + Order data, falling back to the seed baseline. */
export async function getSupplierBehavior(supplier: { id: string; name: string }): Promise<SupplierBehavior> {
  const base = behaviorBaseline(supplier.name);
  const msgs = await prisma.whatsAppMessage.findMany({
    where: { supplierId: supplier.id },
    orderBy: { timestamp: "asc" },
    select: { direction: true, timestamp: true, type: true, body: true },
    take: 4000,
  });

  const replyLat: number[] = [];
  const docLat: number[] = [];
  let oos = 0;
  let inbound = 0;
  for (let i = 1; i < msgs.length; i++) {
    const prev = msgs[i - 1];
    const cur = msgs[i];
    if (cur.direction !== "inbound") continue;
    inbound++;
    if (cur.body && OOS_RX.test(cur.body)) oos++;
    if (prev.direction === "outbound") {
      const dt = (+new Date(cur.timestamp) - +new Date(prev.timestamp)) / 60000;
      if (dt > 0 && dt < 60 * 24 * 3) replyLat.push(dt);
      if ((cur.type === "image" || cur.type === "document") && dt > 0 && dt < 60 * 24) docLat.push(dt);
    }
  }

  const liveReply = replyLat.length >= 8 ? median(replyLat) : null;
  const replyMedianMins = liveReply ?? base?.replyMedianMins ?? null;
  const replySpeed =
    replyMedianMins == null ? "unknown" : replyMedianMins <= 10 ? "fast" : replyMedianMins >= 30 ? "slow" : "normal";

  const liveOos = inbound >= 20 ? Math.round((oos / inbound) * 1000) / 10 : null;
  const oosRatePct = liveOos ?? base?.oosRatePct ?? null;
  const reliability =
    oosRatePct == null ? "unknown" : oosRatePct >= 3 ? "low" : oosRatePct < 1 ? "high" : "medium";

  const docMedianMins = (docLat.length >= 5 ? median(docLat) : null) ?? base?.docMedianMins ?? null;

  const usedLive = liveReply != null || liveOos != null;
  const source: SupplierBehavior["source"] = usedLive && base ? "blend" : usedLive ? "live" : base ? "baseline" : "none";

  return {
    name: supplier.name,
    replyMedianMins,
    replySpeed,
    leadTimeMedianDays: await medianLeadDays(supplier.id),
    docMedianMins,
    oosRatePct,
    reliability,
    source,
    sampleMsgs: inbound,
  };
}

/** Has the supplier blown past their usual reply window? (→ time to chase.) Sync, baseline-aware. */
export function isReplyOverdue(name: string, mutedSinceMs: number): boolean {
  const b = behaviorBaseline(name);
  if (!b || b.replyMedianMins == null) return mutedSinceMs > 6 * 60 * 60 * 1000; // default 6h
  // chase at 4× their median (min 30m, cap 12h) — slow suppliers get more rope.
  const threshold = Math.min(Math.max(b.replyMedianMins * 4, 30), 12 * 60) * 60 * 1000;
  return mutedSinceMs > threshold;
}

/** One-line human description. */
export function describeBehavior(b: SupplierBehavior): string {
  const parts: string[] = [];
  if (b.replyMedianMins != null) parts.push(`⚡ replies ~${b.replyMedianMins < 60 ? `${b.replyMedianMins}m` : `${(b.replyMedianMins / 60).toFixed(1)}h`}`);
  if (b.leadTimeMedianDays != null) parts.push(`📦 lead ~${b.leadTimeMedianDays}d`);
  if (b.docMedianMins != null) parts.push(`🧾 doc ~${b.docMedianMins < 60 ? `${b.docMedianMins}m` : `${(b.docMedianMins / 60).toFixed(1)}h`}`);
  if (b.oosRatePct != null) parts.push(`${b.reliability === "low" ? "⚠️" : ""}OOS ${b.oosRatePct}%`);
  return parts.join(" · ") || "no history yet";
}
