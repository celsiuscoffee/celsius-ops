// Ad-hoc Ops Workspace reminders — human-authored follow-ups / staff to-dos,
// distinct from OpsAlert (detector-driven) and HR memos. Backed by the
// OpsReminder table. Lifecycle: OPEN → DONE | SNOOZED | CANCELLED.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { sendReminder } from "@/lib/ops-pulse/sender";
import { samePhone, ACK_STRONG } from "@/lib/ops-pulse/inbound";

export type ReminderAction = "done" | "snooze" | "reopen" | "cancel";

export interface ReminderView {
  id: string;
  title: string;
  notes: string | null;
  createdByUserId: string;
  createdByName: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  status: string;
  snoozedUntil: string | null;
  doneAt: string | null;
  createdAt: string;
  overdue: boolean;
  // true once the assignee has been WhatsApp'd about this reminder.
  notified: boolean;
}

export interface ReminderScope {
  userId: string;
  role: string;
}

// OWNER/ADMIN oversee the whole workspace; everyone else (MANAGER) sees only
// reminders they created or were assigned.
function isAdminRole(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function scopeWhere(scope: ReminderScope): Prisma.OpsReminderWhereInput {
  if (isAdminRole(scope.role)) return {};
  return { OR: [{ createdByUserId: scope.userId }, { assigneeUserId: scope.userId }] };
}

export async function listReminders(scope: ReminderScope, includeDone = false): Promise<ReminderView[]> {
  const statuses = includeDone ? ["OPEN", "SNOOZED", "DONE", "CANCELLED"] : ["OPEN", "SNOOZED"];
  const rows = await prisma.opsReminder.findMany({
    where: { status: { in: statuses }, ...scopeWhere(scope) },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const ids = Array.from(
    new Set(rows.flatMap((r) => [r.createdByUserId, r.assigneeUserId]).filter(Boolean) as string[]),
  );
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, fullName: true } })
    : [];
  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    const u = users.find((x) => x.id === id);
    return u ? u.fullName || u.name : null;
  };

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes,
    createdByUserId: r.createdByUserId,
    createdByName: nameOf(r.createdByUserId),
    assigneeUserId: r.assigneeUserId,
    assigneeName: nameOf(r.assigneeUserId),
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    status: r.status,
    snoozedUntil: r.snoozedUntil ? r.snoozedUntil.toISOString() : null,
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    overdue: r.status === "OPEN" && !!r.dueAt && r.dueAt.getTime() < now,
    notified: !!r.lastNotifiedAt,
  }));
}

export async function countOpenReminders(scope: ReminderScope): Promise<number> {
  return prisma.opsReminder.count({
    where: { status: { in: ["OPEN", "SNOOZED"] }, ...scopeWhere(scope) },
  });
}

export async function createReminder(input: {
  title: string;
  notes?: string | null;
  dueAt?: Date | null;
  assigneeUserId?: string | null;
  createdByUserId: string;
}): Promise<{ id: string }> {
  return prisma.opsReminder.create({
    data: {
      title: input.title,
      notes: input.notes ?? null,
      dueAt: input.dueAt ?? null,
      // || (not ??) so an empty-string assignee from a form stores null.
      assigneeUserId: input.assigneeUserId || null,
      createdByUserId: input.createdByUserId,
    },
    select: { id: true },
  });
}

// Returns the reminder's owners so the API can authorize non-admins (creator or
// assignee only). null = not found.
export async function getReminderOwners(
  id: string,
): Promise<{ createdByUserId: string; assigneeUserId: string | null } | null> {
  return prisma.opsReminder.findUnique({
    where: { id },
    select: { createdByUserId: true, assigneeUserId: true },
  });
}

export async function updateReminder(
  id: string,
  action: ReminderAction,
  userId: string,
  snoozedUntil?: Date | null,
): Promise<void> {
  const data: Prisma.OpsReminderUpdateInput = {};
  switch (action) {
    case "done":
      data.status = "DONE";
      data.doneAt = new Date();
      data.doneByUserId = userId;
      data.snoozedUntil = null;
      break;
    case "snooze":
      data.status = "SNOOZED";
      data.snoozedUntil = snoozedUntil ?? null;
      break;
    case "reopen":
      data.status = "OPEN";
      data.snoozedUntil = null;
      data.doneAt = null;
      data.doneByUserId = null;
      break;
    case "cancel":
      data.status = "CANCELLED";
      data.snoozedUntil = null;
      break;
  }
  await prisma.opsReminder.update({ where: { id }, data });
}

// ─── WhatsApp delivery ─────────────────────────────────────────────────────

// Human due phrase in MYT for the WhatsApp ping: "" (no due), "due today 3:00 PM",
// "due Sat, 28 Jun" or "overdue" once the time has passed.
function whenPhrase(dueAt: Date | null, now: Date): string {
  if (!dueAt) return "";
  if (dueAt.getTime() < now.getTime()) return "overdue";
  const tz = "Asia/Kuala_Lumpur";
  const sameDay =
    dueAt.toLocaleDateString("en-MY", { timeZone: tz }) === now.toLocaleDateString("en-MY", { timeZone: tz });
  if (sameDay) {
    return "due today " + dueAt.toLocaleTimeString("en-MY", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  }
  return (
    "due " +
    dueAt.toLocaleString("en-MY", { timeZone: tz, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  );
}

export interface NotifyResult {
  sent: boolean;
  reason?: "no_assignee" | "self_assigned" | "no_phone" | "not_open" | "send_failed";
  error?: string;
}

// Ping the assignee on WhatsApp about a reminder and stamp lastNotifiedAt.
// No-ops (without error) when there's nobody to notify: unassigned, the creator
// assigned it to themselves, or the assignee has no phone. `creatorId` lets the
// caller suppress self-pings on create. Never throws.
export async function notifyReminderAssignee(id: string, opts?: { creatorId?: string }): Promise<NotifyResult> {
  const r = await prisma.opsReminder.findUnique({
    where: { id },
    select: { id: true, title: true, notes: true, dueAt: true, assigneeUserId: true, status: true },
  });
  if (!r) return { sent: false, reason: "no_assignee" };
  if (r.status !== "OPEN" && r.status !== "SNOOZED") return { sent: false, reason: "not_open" };
  if (!r.assigneeUserId) return { sent: false, reason: "no_assignee" };
  if (opts?.creatorId && r.assigneeUserId === opts.creatorId) return { sent: false, reason: "self_assigned" };

  const assignee = await prisma.user.findUnique({ where: { id: r.assigneeUserId }, select: { phone: true } });
  if (!assignee?.phone) return { sent: false, reason: "no_phone" };

  const res = await sendReminder(assignee.phone, r.title, r.notes, whenPhrase(r.dueAt, new Date()));
  // Stamp the attempt even on failure — a free-form send outside the 24h window
  // "fails" at Meta but shouldn't make the cron retry it every run; the assignee
  // gets it when they next open a window. (Successful sends obviously stamp too.)
  await prisma.opsReminder.update({ where: { id }, data: { lastNotifiedAt: new Date() } });
  if (!res.ok) return { sent: false, reason: "send_failed", error: res.error };
  return { sent: true };
}

// Due-nudge sweep (cron). Re-pings the assignee of any OPEN reminder that has
// come due but hasn't been nudged since it fell due — so a reminder created days
// early still gets a fresh ping the moment it matters. De-duped on
// lastNotifiedAt vs dueAt so each run only touches genuinely-due, un-nudged ones.
export async function runReminderDueNudges(now = new Date()): Promise<{ considered: number; sent: number }> {
  const rows = await prisma.opsReminder.findMany({
    where: {
      status: "OPEN",
      assigneeUserId: { not: null },
      dueAt: { not: null, lte: now },
      // Never nudged, OR last nudged before it fell due (i.e. the on-assign ping).
      OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: prisma.opsReminder.fields.dueAt } }],
    },
    select: { id: true },
    take: 200,
  });
  let sent = 0;
  for (const r of rows) {
    const res = await notifyReminderAssignee(r.id);
    if (res.sent) sent += 1;
  }
  return { considered: rows.length, sent };
}

// Inbound ack: a staff member replying with a strong completion word ("done",
// "siap"…) marks their OPEN/SNOOZED assigned reminders DONE. Bulk-clear matches
// the digest-batch model (one reply clears the batch); refine to per-item once
// quick-reply buttons land. Returns null when not an ack / not known staff.
export async function handleReminderAck(from: string, text: string): Promise<{ completed: number } | null> {
  if (!from || !ACK_STRONG.test(text)) return null;
  const staff = await prisma.user.findMany({
    where: { status: "ACTIVE", phone: { not: null } },
    select: { id: true, phone: true },
  });
  const user = staff.find((u) => u.phone && samePhone(from, u.phone));
  if (!user) return null;

  const res = await prisma.opsReminder.updateMany({
    where: { assigneeUserId: user.id, status: { in: ["OPEN", "SNOOZED"] } },
    data: { status: "DONE", doneAt: new Date(), doneByUserId: user.id, snoozedUntil: null },
  });
  return { completed: res.count };
}
