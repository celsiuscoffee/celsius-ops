// OpsAlert ledger — the armed-mode spine. Dedupes breaches to one alert each,
// tracks the OPEN → (ESCALATED) → RESOLVED lifecycle, and records delivery.
// Only touched in armed mode (shadow never writes).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { Assignee, Breach } from "./types";

export interface LedgerAlert {
  id: string;
  dedupeKey: string;
  status: string;
  assigneeUserId: string | null;
  summary: string;
  outletId: string;
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
