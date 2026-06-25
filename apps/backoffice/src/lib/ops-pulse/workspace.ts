// Ops Workspace read/act layer over the OpsAlert ledger. The ledger (ledger.ts)
// is written by the pulse cron; this surfaces the still-open alerts in the
// workspace and lets a manager resolve/ack one directly (the same effect a
// "DONE" WhatsApp reply has, but per-alert and from the UI).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export interface PulseAlertView {
  id: string;
  signal: string;
  severity: string;
  summary: string;
  status: string;
  outletId: string;
  outletName: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  sentAt: string | null;
  escalatedAt: string | null;
  createdAt: string;
}

export interface PulseScope {
  userId: string;
  role: string;
}

const OPEN_STATES = ["OPEN", "ESCALATED", "ACKED"];

function isAdminRole(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// OWNER/ADMIN see every open alert; a MANAGER sees only the ones routed to them.
function scopeWhere(scope: PulseScope): Prisma.OpsAlertWhereInput {
  const base: Prisma.OpsAlertWhereInput = { status: { in: OPEN_STATES } };
  if (!isAdminRole(scope.role)) base.assigneeUserId = scope.userId;
  return base;
}

export async function listOpenAlerts(scope: PulseScope): Promise<PulseAlertView[]> {
  const rows = await prisma.opsAlert.findMany({
    where: scopeWhere(scope),
    // Escalated first (most urgent), then newest.
    orderBy: [{ escalatedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      signal: true,
      severity: true,
      summary: true,
      status: true,
      outletId: true,
      assigneeUserId: true,
      sentAt: true,
      escalatedAt: true,
      createdAt: true,
    },
  });

  const userIds = Array.from(new Set(rows.map((r) => r.assigneeUserId).filter(Boolean) as string[]));
  const outletIds = Array.from(new Set(rows.map((r) => r.outletId).filter(Boolean)));
  const [users, outlets] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } })
      : Promise.resolve([] as { id: string; name: string; fullName: string | null }[]),
    outletIds.length
      ? prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const userName = (id: string | null): string | null => {
    if (!id) return null;
    const u = users.find((x) => x.id === id);
    return u ? u.fullName || u.name : null;
  };
  const outletName = (id: string): string | null => outlets.find((o) => o.id === id)?.name ?? null;

  return rows.map((r) => ({
    id: r.id,
    signal: r.signal,
    severity: r.severity,
    summary: r.summary,
    status: r.status,
    outletId: r.outletId,
    outletName: outletName(r.outletId),
    assigneeUserId: r.assigneeUserId,
    assigneeName: userName(r.assigneeUserId),
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    escalatedAt: r.escalatedAt ? r.escalatedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function countOpenAlerts(scope: PulseScope): Promise<number> {
  return prisma.opsAlert.count({ where: scopeWhere(scope) });
}

// For the API to authorize a non-admin (assignee only). null = not found.
export async function getAlertAssignee(id: string): Promise<{ assigneeUserId: string | null } | null> {
  return prisma.opsAlert.findUnique({ where: { id }, select: { assigneeUserId: true } });
}

export async function resolveAlert(id: string): Promise<void> {
  const now = new Date();
  await prisma.opsAlert.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: now, ackedAt: now },
  });
}

export async function ackAlert(id: string): Promise<void> {
  await prisma.opsAlert.update({ where: { id }, data: { status: "ACKED", ackedAt: new Date() } });
}
