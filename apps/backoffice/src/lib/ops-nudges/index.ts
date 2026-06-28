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
import { findNoClockInBreaches, detectOutletAudit, detectSkillTraining, detectReviews } from "@/lib/ops-pulse/detectors";
import { recordBreach } from "@/lib/ops-pulse/ledger";
import { resolveRecipients, resolveOutletTeam } from "@/lib/ops-pulse/router";
import { sendClockInNudge, sendStockCountNudge, sendOpsDigest, sendAuditNudge, sendReviewNudge } from "@/lib/ops-pulse/sender";
import type { Assignee, Breach, RouteKey } from "@/lib/ops-pulse/types";

export type NudgesMode = "off" | "shadow" | "armed";
// Default ARMED (owner go-live 2026-06-28, "full auto"). Kill switch / staging
// via OPS_NUDGES_MODE=off|shadow in Vercel — no code change needed to pause.
export function nudgesMode(): NudgesMode {
  const m = (process.env.OPS_NUDGES_MODE || "armed").trim().toLowerCase();
  return m === "off" || m === "shadow" ? m : "armed";
}

// Stock counts follow the owner-set schedule (Settings → Stock Count): regular
// counts on chosen weekdays + a full count on chosen month-end dates. Stored in
// appConfig. Default mirrors the settings default (Sun/Tue/Thu + 28-31).
const STOCK_SCHEDULE_KEY = "stock_count_schedule";
const DEFAULT_STOCK_SCHEDULE = { weeklyDays: [0, 2, 4], endOfMonthDays: [28, 29, 30, 31] };

async function getStockSchedule(): Promise<{ weeklyDays: number[]; endOfMonthDays: number[] }> {
  const c = await prisma.appConfig.findUnique({ where: { key: STOCK_SCHEDULE_KEY } });
  const v = (c?.value ?? null) as { weeklyDays?: number[]; endOfMonthDays?: number[] } | null;
  return {
    weeklyDays: v?.weeklyDays ?? DEFAULT_STOCK_SCHEDULE.weeklyDays,
    endOfMonthDays: v?.endOfMonthDays ?? DEFAULT_STOCK_SCHEDULE.endOfMonthDays,
  };
}

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

// ── 2. Stock count — schedule-driven ────────────────────────────────────────
// Follows the owner's Stock Count schedule (Settings → Stock Count): fires ONLY
// on a configured count day — a chosen weekday (regular count) or a month-end
// date (full count) — for outlets that haven't logged a SUBMITTED/REVIEWED count
// THAT day. Returns [] on non-count days, so it never nudges off-schedule.
export async function findScheduledStockBreaches(now: Date): Promise<Breach[]> {
  const sched = await getStockSchedule();
  const myt = new Date(now.getTime() + 8 * 3600_000);
  const weekday = myt.getUTCDay(); // 0=Sun … 6=Sat (myt instant read as UTC)
  const dom = myt.getUTCDate();
  const isWeekly = sched.weeklyDays.includes(weekday);
  const isMonthEnd = sched.endOfMonthDays.includes(dom);
  if (!isWeekly && !isMonthEnd) return []; // not a scheduled count day → nothing due
  const full = isMonthEnd; // month-end date = full count

  const ymd = mytYmd(now);
  const dayStart = new Date(`${ymd}T00:00:00+08:00`);
  const [outlets, todayCounts] = await Promise.all([
    prisma.outlet.findMany({ where: { status: "ACTIVE", type: "OUTLET" }, select: { id: true, name: true } }),
    prisma.stockCount.findMany({
      where: { status: { in: ["SUBMITTED", "REVIEWED"] }, countDate: { gte: dayStart } },
      select: { outletId: true },
    }),
  ]);
  const countedToday = new Set(todayCounts.map((r) => r.outletId));
  const label = full ? "Full stock count" : "Stock count";

  const breaches: Breach[] = [];
  for (const o of outlets) {
    if (countedToday.has(o.id)) continue;
    breaches.push({
      signal: "STOCK_COUNT",
      outletId: o.id,
      outletName: o.name,
      severity: "MED",
      routeKey: "operations",
      dedupeKey: `STOCK_NUDGE:${o.id}:${ymd}`, // one nudge per outlet per day
      summary: `${label} due today at ${o.name} — not logged yet.`,
      detail: { full, when: "today" },
    });
  }
  return breaches;
}

export async function runStockCountNudges(now = new Date()): Promise<NudgeRunResult> {
  const mode = nudgesMode();
  const ranAt = now.toISOString();
  if (mode === "off") return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  const breaches = await findScheduledStockBreaches(now);
  if (breaches.length === 0) return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  const managerLines: string[] = [];
  let staffSent = 0;
  for (const b of breaches) {
    const team = await resolveOutletTeam(b.outletId, now); // on-shift staff w/ phone
    const full = Boolean((b.detail as { full?: boolean }).full);

    if (mode === "shadow") {
      console.log("[ops-nudge:stock:shadow]", JSON.stringify({ outlet: b.outletName, team: team.map((t) => t.name), full }));
      managerLines.push(b.summary);
      continue;
    }

    const { isNew } = await recordBreach(b, team[0] ?? null);
    if (!isNew) continue;
    for (const t of team) {
      if (!t.phone) continue;
      const r = await sendStockCountNudge(t.phone, b.outletName, full);
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

// ── 3. Audit progress → discipline lead (barista -> Syafiq, kitchen -> Chef Bo) ──
// DAILY progress snapshot (owner 2026-06-28): each day the lead gets their CURRENT
// outstanding outlet audits + skill-training gaps, routed by discipline. No ledger
// dedupe — it re-sends each daily run, so as they complete audits the list shrinks
// and the skill counts climb (the message updates their progress). The daily cron
// cadence is the once-per-day guard. staffSent = lead DMs sent.
export async function runAuditNudges(now = new Date()): Promise<NudgeRunResult> {
  const mode = nudgesMode();
  const ranAt = now.toISOString();
  if (mode === "off") return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  const breaches = [...(await detectOutletAudit(now)), ...(await detectSkillTraining(now))];
  if (breaches.length === 0) return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  // Group by discipline (routeKey) → that lead's set of audits.
  const byRoute: Record<string, Breach[]> = {};
  for (const b of breaches) (byRoute[b.routeKey] ??= []).push(b);

  let staffSent = 0;
  let items = 0;
  for (const routeKey of Object.keys(byRoute)) {
    const recips = await resolveRecipients(routeKey as RouteKey); // Syafiq / Chef Bo

    if (mode === "shadow") {
      const lines = byRoute[routeKey].map((b) => b.summary);
      console.log("[ops-nudge:audit:shadow]", JSON.stringify({ discipline: routeKey, to: recips.map((r) => r.name), lines }));
      items += lines.length;
      continue;
    }

    // armed — daily progress snapshot: send the lead their CURRENT outstanding
    // audits every run (no dedupe; the daily cron is the cadence). The list
    // shrinks + skill counts climb as they complete, so it reads as progress.
    const lines = byRoute[routeKey].map((b) => b.summary);
    items += lines.length;
    for (const r of recips) {
      if (!r.phone) {
        console.warn(`[ops-nudge:audit] no phone for ${r.name} (${routeKey}) — not nudged`);
        continue;
      }
      const res = await sendAuditNudge(r.phone, r.name, lines);
      if (res.ok) staffSent += 1;
      else console.error(`[ops-nudge:audit] lead nudge to ${r.name} failed:`, res.error);
    }
  }

  return { mode, ranAt, items, staffSent, managerSent: 0 };
}

// ── 4. Bad reviews → on-shift team + managers ────────────────────────────────
// New negative reviews (internal QR <=2*, Google <=3*) DM'd to the outlet's
// on-shift team for service recovery + a digest to the managers (ops leads).
// Ledger-deduped per review (each review nudged once, ever). Real-time-ish — the
// cron runs hourly. Reuses detectReviews.
export async function runReviewNudges(now = new Date()): Promise<NudgeRunResult> {
  const mode = nudgesMode();
  const ranAt = now.toISOString();
  if (mode === "off") return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  const breaches = await detectReviews(now);
  if (breaches.length === 0) return { mode, ranAt, items: 0, staffSent: 0, managerSent: 0 };

  // Group by outlet so each outlet's team gets one message listing its reviews.
  const byOutlet: Record<string, Breach[]> = {};
  for (const b of breaches) (byOutlet[b.outletId] ??= []).push(b);

  const managerLines: string[] = [];
  let staffSent = 0;
  for (const outletId of Object.keys(byOutlet)) {
    const outletName = byOutlet[outletId][0].outletName;

    // Dedupe per review (armed); shadow shows all.
    let fresh = byOutlet[outletId];
    if (mode === "armed") {
      fresh = [];
      for (const b of byOutlet[outletId]) {
        const { isNew } = await recordBreach(b, null);
        if (isNew) fresh.push(b);
      }
    }
    if (fresh.length === 0) continue;
    const lines = fresh.map((b) => b.summary);
    managerLines.push(...lines);

    const team = await resolveOutletTeam(outletId, now); // who's on shift now
    if (mode === "shadow") {
      console.log("[ops-nudge:review:shadow]", JSON.stringify({ outlet: outletName, team: team.map((t) => t.name), lines }));
      continue;
    }
    for (const t of team) {
      if (!t.phone) continue;
      const r = await sendReviewNudge(t.phone, outletName, lines);
      if (r.ok) staffSent += 1;
      else console.error(`[ops-nudge:review] staff nudge to ${t.name} failed:`, r.error);
    }
    if (team.length === 0) console.warn(`[ops-nudge:review] no on-shift team for ${outletName} — only managers notified`);
  }

  const headline = `${managerLines.length} new guest review${managerLines.length === 1 ? "" : "s"} need a response`;
  const managerSent = await sendManagerDigestToOps(headline, managerLines, mode);
  return { mode, ranAt, items: managerLines.length, staffSent, managerSent };
}
