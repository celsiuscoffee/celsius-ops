// Real-time staff+manager nudges (owner request 2026-06-28):
//   1. No clock-in  → DM the no-show staff + a digest to the manager.
//   2. No stock count → DM the on-shift team + a digest to the manager.
//
// Distinct from the weekly scoreboard (passive, aggregate, manager-owned): this
// is the ACTIVE push that makes the clock-in / count actually happen. Reuses the
// pulse detectors (detection), the OpsAlert ledger (dedupe — never nudge the same
// person twice for the same day), and the WhatsApp sender, but with tailored
// per-recipient phrasing (gentle 1st-person to staff; factual digest to manager).
//
// "Manager" = the ops discipline leads (RECIPIENTS.operations — Ariff/Adam) until
// an outlet→manager map exists. "Staff" = the specific no-show (clock-in) or the
// on-shift team (stock). Mode: OPS_NUDGES_MODE (off | shadow | armed, default
// shadow — logs what it would send, sends nothing). Delivery is still bound by
// WhatsApp's 24h rule until ops_nudge is approved.

import { prisma } from "@/lib/prisma";
import { findNoClockInBreaches } from "@/lib/ops-pulse/detectors";
import { recordBreach } from "@/lib/ops-pulse/ledger";
import { resolveRecipients, resolveOutletTeam } from "@/lib/ops-pulse/router";
import { sendClockInNudge, sendStockCountNudge, sendOpsDigest } from "@/lib/ops-pulse/sender";
import type { Assignee, Breach } from "@/lib/ops-pulse/types";

export type NudgesMode = "off" | "shadow" | "armed";
export function nudgesMode(): NudgesMode {
  const m = (process.env.OPS_NUDGES_MODE || "shadow").trim().toLowerCase();
  return m === "off" || m === "armed" ? m : "shadow";
}

// Owner choice 2026-06-28: nudge if no stock count in the last 3 days.
const STOCK_STALE_DAYS = Number(process.env.OPS_NUDGE_STOCK_DAYS || 3);

function mytYmd(now: Date): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
function mask(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/[^0-9]/g, "");
  return d.length <= 4 ? "****" : `••••${d.slice(-4)}`;
}

export interface NudgeRunResult {
  mode: NudgesMode;
  ranAt: string;
  items: number; // distinct breaches actioned (new, in armed) / seen (shadow)
  staffSent: number;
  managerSent: number;
}

async function sendManagerDigestToOps(headline: string, lines: string[], mode: NudgesMode): Promise<number> {
  if (lines.length === 0) return 0;
  const recips = await resolveRecipients("operations");
  if (mode === "shadow") {
    console.log("[ops-nudge:shadow:manager]", JSON.stringify({ to: recips.map((r) => r.name), headline, lines }));
    return 0;
  }
  let sent = 0;
  for (const m of recips) {
    if (!m.phone) continue;
    const r = await sendOpsDigest(m.phone, headline, lines);
    if (r.ok) sent += 1;
    else console.error(`[ops-nudge] manager digest to ${m.name} failed:`, r.error);
  }
  return sent;
}

// ── 1. No clock-in ──────────────────────────────────────────────────────────
export async function runClockInNudges(now = new Date()): Promise<NudgeRunResult> {
  const mode = nudgesMode();
  const ranAt = now.toISOString();
  if (mode === "off") return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  const breaches = await findNoClockInBreaches(now);
  if (breaches.length === 0) return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  const ids = [...new Set(breaches.map((b) => String(b.detail.userId ?? "")).filter(Boolean))];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, fullName: true, phone: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const managerLines: string[] = [];
  let staffSent = 0;
  for (const b of breaches) {
    const uid = String(b.detail.userId ?? "");
    const u = byId.get(uid);
    const phone = u?.phone ?? null;
    const name = u ? u.fullName || u.name : uid;
    const startTime = String(b.detail.scheduledStart ?? "").slice(0, 5) || "today";

    if (mode === "shadow") {
      console.log("[ops-nudge:clockin:shadow]", JSON.stringify({ staff: name, phone: mask(phone), outlet: b.outletName, start: startTime }));
      managerLines.push(b.summary);
      continue;
    }

    // armed — dedupe so a 30-min cron only nudges each no-show once per day.
    const primary: Assignee | null = u ? { userId: u.id, name, phone, role: "staff", fallback: false } : null;
    const { isNew } = await recordBreach(b, primary);
    if (!isNew) continue;
    if (phone) {
      const r = await sendClockInNudge(phone, name, b.outletName, startTime);
      if (r.ok) staffSent += 1;
      else console.error(`[ops-nudge:clockin] staff nudge to ${name} failed:`, r.error);
    } else {
      console.warn(`[ops-nudge:clockin] no phone on file for ${name} — staff not nudged`);
    }
    managerLines.push(b.summary);
  }

  const headline = `${managerLines.length} staff haven't clocked in yet for today's shift`;
  const managerSent = await sendManagerDigestToOps(headline, managerLines, mode);
  return { mode, ranAt, items: managerLines.length, staffSent, managerSent };
}

// ── 2. No stock count ───────────────────────────────────────────────────────
export async function findStaleStockBreaches(now: Date, days: number): Promise<Breach[]> {
  const ymd = mytYmd(now);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const [outlets, recent, lastCounts] = await Promise.all([
    prisma.outlet.findMany({ where: { status: "ACTIVE", type: "OUTLET" }, select: { id: true, name: true } }),
    prisma.stockCount.findMany({
      where: { status: { in: ["SUBMITTED", "REVIEWED"] }, countDate: { gte: cutoff } },
      select: { outletId: true },
    }),
    prisma.stockCount.groupBy({
      by: ["outletId"],
      where: { status: { in: ["SUBMITTED", "REVIEWED"] } },
      _max: { countDate: true },
    }),
  ]);
  const counted = new Set(recent.map((r) => r.outletId));
  const lastBy = new Map(lastCounts.map((r) => [r.outletId, r._max.countDate ?? null]));

  const breaches: Breach[] = [];
  for (const o of outlets) {
    if (counted.has(o.id)) continue;
    const last = lastBy.get(o.id) ?? null;
    const daysSince = last ? Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000) : null;
    const when = daysSince === null ? "no count on record" : `${daysSince}d ago`;
    breaches.push({
      signal: "STOCK_COUNT",
      outletId: o.id,
      outletName: o.name,
      severity: "MED",
      routeKey: "operations",
      // Daily dedupe key (own namespace so it can't collide with the pulse's
      // 7-day STOCK_COUNT bucket) → at most one nudge per outlet per day.
      dedupeKey: `STOCK_NUDGE:${o.id}:${ymd}`,
      summary: `Stock count overdue at ${o.name} — last ${when}. Please count + submit today.`,
      detail: { daysSince, when, lastCount: last ? new Date(last).toISOString().slice(0, 10) : null },
    });
  }
  return breaches;
}

export async function runStockCountNudges(now = new Date()): Promise<NudgeRunResult> {
  const mode = nudgesMode();
  const ranAt = now.toISOString();
  if (mode === "off") return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  const breaches = await findStaleStockBreaches(now, STOCK_STALE_DAYS);
  if (breaches.length === 0) return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  const managerLines: string[] = [];
  let staffSent = 0;
  for (const b of breaches) {
    const team = await resolveOutletTeam(b.outletId, now); // on-shift staff w/ phone
    const when = String((b.detail as { when?: string }).when ?? "");

    if (mode === "shadow") {
      console.log("[ops-nudge:stock:shadow]", JSON.stringify({ outlet: b.outletName, team: team.map((t) => t.name), when }));
      managerLines.push(b.summary);
      continue;
    }

    const { isNew } = await recordBreach(b, team[0] ?? null);
    if (!isNew) continue;
    for (const t of team) {
      if (!t.phone) continue;
      const r = await sendStockCountNudge(t.phone, b.outletName, when);
      if (r.ok) staffSent += 1;
      else console.error(`[ops-nudge:stock] staff nudge to ${t.name} failed:`, r.error);
    }
    if (team.length === 0) console.warn(`[ops-nudge:stock] no on-shift team for ${b.outletName} — only manager notified`);
    managerLines.push(b.summary);
  }

  const headline = `${managerLines.length} outlet${managerLines.length === 1 ? "" : "s"} need a stock count today`;
  const managerSent = await sendManagerDigestToOps(headline, managerLines, mode);
  return { mode, ranAt, items: managerLines.length, staffSent, managerSent };
}
