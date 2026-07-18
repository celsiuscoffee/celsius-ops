// OpsAlert ledger — the armed-mode spine. Dedupes breaches to one alert each,
// tracks the OPEN → (ESCALATED) → RESOLVED lifecycle, and records delivery.
// Only touched in armed mode (shadow never writes).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { resolveOwner } from "./router";
import { sendOpsDigest } from "./sender";
import type { Assignee, Breach } from "./types";

export interface LedgerAlert {
  id: string;
  dedupeKey: string;
  status: string;
  assigneeUserId: string | null;
  summary: string;
  outletId: string;
}

// ── Runaway guard ────────────────────────────────────────────────────────────
// A well-behaved signal creates a bounded number of alerts per outlet per day.
// A churning dedupeKey (e.g. hashing volatile state, like the menu-86 set-hash
// that re-fired ~23x on 2026-07-03 because availability flapped) silently emits
// dozens. This caps NEW alerts per (signal, outlet, day) so ANY future dedupe
// bug is stopped at the source AND pages the owner once — instead of blasting
// staff until someone reads the logs. The cap is a backstop, not the primary
// mechanism: a correct dedupeKey never approaches it.
//
// Singletons should be ~1/outlet/day (tight cap). The per-entity signals run
// higher — CHECKLIST is per task (~10-26/outlet/day), NO_CLOCK_IN per staff
// (~20), REVIEW per review — so they get generous headroom.
const SINGLETON_SIGNALS = new Set([
  "MENU_SNOOZED",
  "POS_NOT_OPEN",
  "PHONE_CAPTURE",
  "STOCK_COUNT",
  "ROSTER_MISSING",
  "RESTOCK_NEEDED",
]);
const RUNAWAY_CAP_SINGLETON = 3;
const RUNAWAY_CAP_MULTI = 60;

function mytDayStart(): Date {
  const ymd = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  return new Date(`${ymd}T00:00:00+08:00`);
}

// A suppressed breach looks not-new to callers (they skip it), with a stub the
// callers never dereference (they only touch `alert` on the isNew path).
function suppressedStub(breach: Breach): LedgerAlert {
  return { id: "", dedupeKey: breach.dedupeKey, status: "SUPPRESSED", assigneeUserId: null, summary: breach.summary, outletId: breach.outletId };
}

// Log + page the owner ONCE per (signal, outlet, day). The marker row's unique
// dedupeKey is the once-per-day dedup: the owner DM only sends when the marker
// create succeeds (first trip). Best-effort — never throws into the caller.
async function handleRunaway(breach: Breach, count: number, cap: number): Promise<void> {
  console.error(
    `[ledger] RUNAWAY ${breach.signal} @outlet ${breach.outletId}: ${count} alerts today (cap ${cap}) — suppressing further sends; a dedupeKey is likely churning`,
  );
  const ymd = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  try {
    await prisma.opsAlert.create({
      data: {
        signal: "RUNAWAY",
        outletId: breach.outletId,
        severity: "HIGH",
        dedupeKey: `RUNAWAY:${breach.signal}:${breach.outletId}:${ymd}`,
        summary: `Ops nudge auto-suppressed: ${breach.signal} fired ${count}+ times today`,
        detail: { signal: breach.signal, count, cap } as Prisma.InputJsonValue,
        status: "OPEN",
      },
    });
    // Marker created => first trip today => tell the owner.
    const owner = await resolveOwner();
    if (owner?.phone) {
      await sendOpsDigest(owner.phone, "Ops nudge auto-suppressed", [
        `${breach.signal} fired ${count}+ times today at one outlet and was capped. Likely a loop or dedupe bug, not real events. Check the ops nudges.`,
      ]);
    }
  } catch (err) {
    // P2002 = already alerted today (marker exists) — expected, stay silent.
    if ((err as { code?: string } | null)?.code !== "P2002") {
      console.error("[ledger] runaway owner-alert failed:", err);
    }
  }
}

const ALERT_SELECT = {
  id: true,
  dedupeKey: true,
  status: true,
  assigneeUserId: true,
  summary: true,
  outletId: true,
} as const;

// Create the alert on first sight of a dedupeKey; otherwise return the existing
// row untouched. isNew=true is the "page this now" signal — so a breach is never
// paged twice.
export async function recordBreach(
  breach: Breach,
  assignee: Assignee | null,
): Promise<{ alert: LedgerAlert; isNew: boolean }> {
  const existing = await prisma.opsAlert.findUnique({
    where: { dedupeKey: breach.dedupeKey },
    select: ALERT_SELECT,
  });
  if (existing) return { alert: existing, isNew: false };

  // Runaway guard: a genuinely-new dedupeKey, but has this (signal, outlet)
  // already blown its daily cap? If so a dedupeKey is churning — suppress the
  // send and page the owner once, rather than blast staff all day.
  const cap = SINGLETON_SIGNALS.has(breach.signal) ? RUNAWAY_CAP_SINGLETON : RUNAWAY_CAP_MULTI;
  const todayCount = await prisma.opsAlert.count({
    where: { signal: breach.signal, outletId: breach.outletId, createdAt: { gte: mytDayStart() } },
  });
  if (todayCount >= cap) {
    await handleRunaway(breach, todayCount, cap);
    return { alert: suppressedStub(breach), isNew: false };
  }

  try {
    const created = await prisma.opsAlert.create({
      data: {
        signal: breach.signal,
        outletId: breach.outletId,
        severity: breach.severity,
        dedupeKey: breach.dedupeKey,
        summary: breach.summary,
        detail: breach.detail as Prisma.InputJsonValue,
        status: "OPEN",
        // || (not ??) so a phone-only recipient (userId "") stores null, not "".
        assigneeUserId: assignee?.userId || null,
      },
      select: ALERT_SELECT,
    });
    return { alert: created, isNew: true };
  } catch (err) {
    // Concurrent run won the race on the @unique dedupeKey (overlapping cron):
    // Prisma P2002 = unique-constraint violation. Re-read and treat as not-new
    // so we never double-page or crash the run.
    if ((err as { code?: string } | null)?.code === "P2002") {
      const row = await prisma.opsAlert.findUnique({
        where: { dedupeKey: breach.dedupeKey },
        select: ALERT_SELECT,
      });
      if (row) return { alert: row, isNew: false };
    }
    throw err;
  }
}

export async function markSent(id: string, providerMessageId: string | null): Promise<void> {
  await prisma.opsAlert.update({
    where: { id },
    data: { sentAt: new Date(), channel: "whatsapp", providerMessageId },
  });
}

export interface EscalatableAlert {
  id: string;
  outletId: string;
  summary: string;
  severity: string;
  assigneeUserId: string | null;
}

// OPEN alerts sent but unacked past the SLA. Escalates only signals that
// actually enter the ledger (the real-time tier): CHECKLIST, REVIEW, RECEIVING,
// NO_CLOCK_IN, POS_NOT_OPEN. MENU_SNOOZED is real-time but self-clears, so it's
// excluded. AUDIT/skill escalation is pending the routine-ledger path (they're
// daily, not real-time, so they aren't persisted here yet).
//
// Exception: LOW-severity REVIEW alerts are the happy-but-fixable notes from
// positive reviews (negatives are always MED/HIGH). They're improvement TIPS,
// not incidents — nobody acks a tip, so without this they'd all bubble to the
// owner after the SLA. Keep them with the team/managers; never escalate.
export async function findEscalatable(slaMinutes: number, now: Date): Promise<EscalatableAlert[]> {
  const cutoff = new Date(now.getTime() - slaMinutes * 60_000);
  return prisma.opsAlert.findMany({
    where: {
      status: "OPEN",
      signal: { in: ["CHECKLIST", "REVIEW", "RECEIVING", "NO_CLOCK_IN", "POS_NOT_OPEN"] },
      NOT: { signal: "REVIEW", severity: "LOW" }, // positive-review improvement tips don't escalate
      escalatedAt: null,
      sentAt: { not: null, lt: cutoff },
    },
    select: { id: true, outletId: true, summary: true, severity: true, assigneeUserId: true },
    orderBy: { sentAt: "asc" },
    take: 100,
  });
}

export async function markEscalated(id: string): Promise<void> {
  await prisma.opsAlert.update({
    where: { id },
    data: { status: "ESCALATED", escalatedAt: new Date() },
  });
}

// ── Auto-expiry ──────────────────────────────────────────────────────────────
// EXPIRED is the ledger's designed terminal state for alerts whose moment has
// passed, but nothing ever set it — so day-bound alerts accumulated as OPEN
// forever (953 open at the 2026-07-18 sweep, ~94% of them naturally dead).
//
// Day-bound signals describe ONE business day (an overdue checklist, a missed
// clock-in, a till not opened): once that day is a few days gone, the alert is
// historical fact, not a to-do. State-bound MENU_SNOOZED gets longer — the
// snooze may persist — but a 2-week-old snooze alert is stale information
// either way. Expiring never causes a re-page: recordBreach dedupes on the
// dedupeKey row regardless of status, and day-bound keys carry the date.
const DAY_BOUND_SIGNALS = ["CHECKLIST", "NO_CLOCK_IN", "POS_NOT_OPEN", "STOCK_COUNT", "RUNAWAY"];
const DAY_BOUND_EXPIRY_DAYS = 3;
const STATE_BOUND_SIGNALS = ["MENU_SNOOZED"];
const STATE_BOUND_EXPIRY_DAYS = 14;

export async function expireStaleAlerts(now: Date = new Date()): Promise<number> {
  const dayCutoff = new Date(now.getTime() - DAY_BOUND_EXPIRY_DAYS * 86_400_000);
  const stateCutoff = new Date(now.getTime() - STATE_BOUND_EXPIRY_DAYS * 86_400_000);
  const live = ["OPEN", "ACKED", "ESCALATED"];
  const [day, state] = await Promise.all([
    prisma.opsAlert.updateMany({
      where: { status: { in: live }, signal: { in: DAY_BOUND_SIGNALS }, createdAt: { lt: dayCutoff } },
      data: { status: "EXPIRED" },
    }),
    prisma.opsAlert.updateMany({
      where: { status: { in: live }, signal: { in: STATE_BOUND_SIGNALS }, createdAt: { lt: stateCutoff } },
      data: { status: "EXPIRED" },
    }),
  ]);
  return day.count + state.count;
}

// Resolve every still-open alert assigned to a user — called when they reply to
// a digest (e.g. "DONE"). Returns how many were closed.
export async function resolveOpenAlertsForUser(userId: string): Promise<number> {
  const now = new Date();
  const res = await prisma.opsAlert.updateMany({
    where: { assigneeUserId: userId, status: { in: ["OPEN", "ESCALATED", "ACKED"] } },
    data: { status: "RESOLVED", resolvedAt: now, ackedAt: now },
  });
  return res.count;
}
