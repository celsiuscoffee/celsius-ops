// Ad-hoc Ops Workspace reminders — human-authored follow-ups / staff to-dos,
// distinct from OpsAlert (detector-driven) and HR memos. Backed by the
// OpsReminder table. Lifecycle: OPEN → DONE | SNOOZED | CANCELLED.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

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
