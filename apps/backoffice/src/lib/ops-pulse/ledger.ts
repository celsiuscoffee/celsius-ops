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

  const created = await prisma.opsAlert.create({
    data: {
      signal: breach.signal,
      outletId: breach.outletId,
      severity: breach.severity,
      dedupeKey: breach.dedupeKey,
      summary: breach.summary,
      detail: breach.detail as Prisma.InputJsonValue,
      status: "OPEN",
      assigneeUserId: assignee?.userId ?? null,
    },
    select: ALERT_SELECT,
  });
  return { alert: created, isNew: true };
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
}

// OPEN, actionable-incident alerts sent but unacked past the SLA. Only now-fix-it
// incidents escalate (CHECKLIST, REVIEW, RECEIVING). Excluded on purpose:
// PHONE_CAPTURE / STOCK_COUNT / MENU_SNOOZED (rates/coaching that self-clear) and
// AUDIT (lagging) — escalating those on a 90-min timer would cry wolf.
export async function findEscalatable(slaMinutes: number, now: Date): Promise<EscalatableAlert[]> {
  const cutoff = new Date(now.getTime() - slaMinutes * 60_000);
  return prisma.opsAlert.findMany({
    where: {
      status: "OPEN",
      signal: { in: ["CHECKLIST", "REVIEW", "RECEIVING"] },
      escalatedAt: null,
      sentAt: { not: null, lt: cutoff },
    },
    select: { id: true, outletId: true, summary: true, severity: true },
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
