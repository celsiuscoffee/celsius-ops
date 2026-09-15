// Owner to-do board: the kanban view over OpsReminder for the OWNER account.
// Shared by the /owner/todo page API, the Telegram digest buttons, and the
// capture agent, so a card moves the same way no matter where the owner
// touched it. Design: docs/design/owner-todo-kanban.md.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { logAgentAction } from "@celsius/agents/src/substrate";
import { CAPTURE_AGENT_KEY } from "./capture";

export const STAGES = ["triage", "todo", "doing", "waiting", "done"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  triage: "Triage",
  todo: "To Do",
  doing: "Doing",
  waiting: "Waiting on",
  done: "Done",
};

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

export interface CardView {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  overdue: boolean;
  stage: Stage;
  status: string;
  source: string;
  sourceChat: string | null;
  sourceExcerpt: string | null;
  sourceRef: string | null;
  proposedByAgent: boolean;
  confidence: number | null;
  triageDecision: string | null;
  createdAt: string;
  doneAt: string | null;
}

// The single OWNER account the board belongs to. Null if none is active.
export async function getOwnerUser(): Promise<{ id: string; name: string } | null> {
  const u = await prisma.user.findFirst({
    where: { role: "OWNER", status: "ACTIVE" },
    select: { id: true, name: true, fullName: true },
    orderBy: { createdAt: "asc" },
  });
  return u ? { id: u.id, name: (u.fullName || u.name).split(" ")[0] } : null;
}

// Everything on the owner's board: cards he created for himself (no
// assignee) or that were assigned to him. Rejected proposals and cancelled
// cards are kept in the DB (dedup + precision) but never shown. Done cards
// fall off after 14 days.
function boardWhere(ownerId: string): Prisma.OpsReminderWhereInput {
  const doneCutoff = new Date(Date.now() - 14 * 86400_000);
  return {
    OR: [{ createdByUserId: ownerId, assigneeUserId: null }, { assigneeUserId: ownerId }],
    AND: [
      { status: { not: "CANCELLED" } },
      { OR: [{ status: { not: "DONE" } }, { doneAt: { gte: doneCutoff } }] },
    ],
  };
}

function toView(r: Prisma.OpsReminderGetPayload<Record<string, never>>): CardView {
  const stage: Stage = isStage(r.stage) ? r.stage : "todo";
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    overdue: r.status !== "DONE" && !!r.dueAt && r.dueAt.getTime() < Date.now(),
    stage,
    status: r.status,
    source: r.source,
    sourceChat: r.sourceChat,
    sourceExcerpt: r.sourceExcerpt,
    sourceRef: r.sourceRef,
    proposedByAgent: r.proposedByAgent,
    confidence: r.confidence,
    triageDecision: r.triageDecision,
    createdAt: r.createdAt.toISOString(),
    doneAt: r.doneAt ? r.doneAt.toISOString() : null,
  };
}

export async function listBoard(ownerId: string): Promise<CardView[]> {
  const rows = await prisma.opsReminder.findMany({
    where: boardWhere(ownerId),
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 500,
  });
  return rows.map(toView);
}

// Precision of the capture agent: the number the arming criteria are read
// from. Window in days; counts only proposals the owner has ruled on.
export async function captureStats(days = 14): Promise<{ proposed: number; accepted: number; rejected: number; pending: number; precision: number | null }> {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await prisma.opsReminder.groupBy({
    by: ["triageDecision"],
    where: { proposedByAgent: true, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const n = (d: string | null) => rows.find((r) => r.triageDecision === d)?._count._all ?? 0;
  const accepted = n("accepted");
  const rejected = n("rejected");
  const pending = n(null);
  const ruled = accepted + rejected;
  return { proposed: ruled + pending, accepted, rejected, pending, precision: ruled ? accepted / ruled : null };
}

async function ownedCard(id: string, ownerId: string) {
  const r = await prisma.opsReminder.findFirst({ where: { id, ...boardWhere(ownerId) } });
  return r;
}

// Move a card to a column. Leaving Triage for any real column is an accept;
// entering Done closes it; leaving Done reopens it.
export async function moveCard(id: string, ownerId: string, stage: Stage, via: "board" | "telegram" = "board"): Promise<CardView | null> {
  const r = await ownedCard(id, ownerId);
  if (!r) return null;
  const data: Prisma.OpsReminderUpdateInput = { stage };
  if (stage === "done") {
    data.status = "DONE";
    data.doneAt = new Date();
    data.doneByUserId = ownerId;
    data.snoozedUntil = null;
  } else if (r.status === "DONE") {
    data.status = "OPEN";
    data.doneAt = null;
    data.doneByUserId = null;
  }
  if (r.proposedByAgent && r.stage === "triage" && stage !== "triage" && r.triageDecision == null) {
    data.triageDecision = "accepted";
    await logAgentAction({
      agentKey: CAPTURE_AGENT_KEY,
      kind: "todo_accepted",
      summary: `Accepted via ${via}: ${r.title}`,
      refTable: "OpsReminder",
      refId: r.id,
      autonomous: false,
      meta: { to: stage },
    });
  }
  const updated = await prisma.opsReminder.update({ where: { id }, data });
  return toView(updated);
}

// Reject a proposal: recorded as the negative outcome, hidden from the board,
// row kept so the same message is never re-proposed.
export async function rejectCard(id: string, ownerId: string, via: "board" | "telegram" = "board"): Promise<boolean> {
  const r = await ownedCard(id, ownerId);
  if (!r) return false;
  await prisma.opsReminder.update({
    where: { id },
    data: { status: "CANCELLED", triageDecision: r.proposedByAgent ? "rejected" : r.triageDecision, snoozedUntil: null },
  });
  if (r.proposedByAgent) {
    await logAgentAction({
      agentKey: CAPTURE_AGENT_KEY,
      kind: "todo_rejected",
      summary: `Rejected via ${via}: ${r.title}`,
      refTable: "OpsReminder",
      refId: r.id,
      autonomous: false,
    });
  }
  return true;
}

// Push the due date to tomorrow 9am MYT (or set one if the card had none).
export async function snoozeCardToTomorrow(id: string, ownerId: string): Promise<CardView | null> {
  const r = await ownedCard(id, ownerId);
  if (!r) return null;
  const tomorrow = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }) + "T09:00:00+08:00");
  tomorrow.setDate(tomorrow.getDate() + 1);
  const updated = await prisma.opsReminder.update({ where: { id }, data: { dueAt: tomorrow, status: r.status === "DONE" ? "DONE" : "OPEN", snoozedUntil: null } });
  return toView(updated);
}

export async function createCard(ownerId: string, input: { title: string; notes?: string | null; dueAt?: Date | null; stage?: Stage }): Promise<CardView> {
  const stage: Stage = input.stage && input.stage !== "triage" ? input.stage : "todo";
  const r = await prisma.opsReminder.create({
    data: {
      title: input.title.trim().slice(0, 200),
      notes: input.notes?.trim() || null,
      dueAt: input.dueAt ?? null,
      createdByUserId: ownerId,
      assigneeUserId: null,
      source: "manual",
      stage,
      status: stage === "done" ? "DONE" : "OPEN",
      doneAt: stage === "done" ? new Date() : null,
    },
  });
  return toView(r);
}

export async function editCard(id: string, ownerId: string, input: { title?: string; notes?: string | null; dueAt?: Date | null }): Promise<CardView | null> {
  const r = await ownedCard(id, ownerId);
  if (!r) return null;
  const data: Prisma.OpsReminderUpdateInput = {};
  if (typeof input.title === "string" && input.title.trim()) data.title = input.title.trim().slice(0, 200);
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  if (input.dueAt !== undefined) data.dueAt = input.dueAt;
  const updated = await prisma.opsReminder.update({ where: { id }, data });
  return toView(updated);
}
