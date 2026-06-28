// Ops Workspace instructions — an ad-hoc directive/announcement the owner or a
// manager sends to staff over WhatsApp, fanned out to a chosen audience and
// tracked per-recipient for delivery + acknowledgement. Distinct from OpsReminder
// (a single-owner to-do) and OpsAlert (detector-driven). Backed by
// OpsInstruction + OpsInstructionRecipient.
//
// Audience targeting (owner choice 2026-06-27 — "people + groups"):
//   users        — explicit list of staff
//   outlet       — everyone on a published shift at an outlet today (roster)
//   discipline   — the ops-pulse routeKey leads (operations / barista / kitchen)
//   all_managers — every active MANAGER + OWNER
//
// Acks (owner choice — "track per-recipient"): a recipient replying OK/DONE flips
// their pending rows to acked; the workspace shows acked vs pending and can nudge
// the stragglers.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { sendInstruction } from "@/lib/ops-pulse/sender";
import { resolveOutletTeam, resolveRecipients } from "@/lib/ops-pulse/router";
import { samePhone, ACK_SOFT } from "@/lib/ops-pulse/inbound";
import type { RouteKey } from "@/lib/ops-pulse/types";

export type Severity = "normal" | "important" | "urgent";

export type AudienceInput =
  | { type: "users"; userIds: string[] }
  | { type: "outlet"; outletId: string }
  | { type: "discipline"; routeKey: RouteKey }
  | { type: "all_managers" };

const DISCIPLINE_LABEL: Record<RouteKey, string> = {
  operations: "Operations leads",
  barista: "Barista lead",
  kitchen: "Kitchen lead",
};

interface ResolvedRecipient {
  userId: string | null;
  name: string;
  phone: string | null;
}

// Collapse the chosen audience to a de-duped recipient list + a human label
// (snapshotted on the instruction for display). Empty list = nobody resolved.
export async function resolveAudience(
  audience: AudienceInput,
  now: Date,
): Promise<{ recipients: ResolvedRecipient[]; label: string }> {
  let raw: ResolvedRecipient[] = [];
  let label = "";

  switch (audience.type) {
    case "users": {
      const ids = Array.from(new Set(audience.userIds.filter(Boolean)));
      if (ids.length) {
        const users = await prisma.user.findMany({
          where: { id: { in: ids }, status: "ACTIVE" },
          select: { id: true, name: true, fullName: true, phone: true },
        });
        raw = users.map((u) => ({ userId: u.id, name: u.fullName || u.name, phone: u.phone }));
      }
      label = raw.length === 1 ? raw[0].name : `${raw.length} staff`;
      break;
    }
    case "outlet": {
      const [team, outlet] = await Promise.all([
        resolveOutletTeam(audience.outletId, now),
        prisma.outlet.findUnique({ where: { id: audience.outletId }, select: { name: true } }),
      ]);
      raw = team.map((a) => ({ userId: a.userId || null, name: a.name, phone: a.phone }));
      label = `On shift · ${outlet?.name ?? "outlet"}`;
      break;
    }
    case "discipline": {
      const leads = await resolveRecipients(audience.routeKey);
      raw = leads.map((a) => ({ userId: a.userId || null, name: a.name, phone: a.phone }));
      label = DISCIPLINE_LABEL[audience.routeKey] ?? audience.routeKey;
      break;
    }
    case "all_managers": {
      const mgrs = await prisma.user.findMany({
        where: { status: "ACTIVE", role: { in: ["MANAGER", "OWNER"] } },
        select: { id: true, name: true, fullName: true, phone: true },
      });
      raw = mgrs.map((u) => ({ userId: u.id, name: u.fullName || u.name, phone: u.phone }));
      label = "All managers";
      break;
    }
  }

  // De-dupe by userId (preferred) else phone digits.
  const seen = new Set<string>();
  const recipients: ResolvedRecipient[] = [];
  for (const r of raw) {
    const key = r.userId || (r.phone ? r.phone.replace(/[^0-9]/g, "").slice(-9) : "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipients.push(r);
  }
  return { recipients, label };
}

export interface CreateInstructionResult {
  id: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number; // recipients with no phone on file
}

// Persist the instruction + its recipients, then fan out the WhatsApp send and
// stamp each recipient's delivery state. Throws only on a hard DB failure; an
// empty audience returns a zero-recipient result the caller can surface.
export async function createAndSendInstruction(input: {
  title: string;
  body: string;
  severity: Severity;
  audience: AudienceInput;
  createdByUserId: string;
}): Promise<CreateInstructionResult> {
  const now = new Date();
  const [{ recipients, label }, author] = await Promise.all([
    resolveAudience(input.audience, now),
    prisma.user.findUnique({ where: { id: input.createdByUserId }, select: { name: true, fullName: true } }),
  ]);
  const fromName = author?.fullName || author?.name || "Management";

  const instruction = await prisma.opsInstruction.create({
    data: {
      title: input.title,
      body: input.body,
      severity: input.severity,
      createdByUserId: input.createdByUserId,
      audience: { ...input.audience, label } as Prisma.InputJsonValue,
      recipients: {
        create: recipients.map((r) => ({
          userId: r.userId,
          name: r.name,
          phone: r.phone ? r.phone.replace(/[^0-9]/g, "") : null,
          deliveryStatus: r.phone ? "pending" : "skipped",
        })),
      },
    },
    select: { id: true, recipients: { select: { id: true, phone: true } } },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const rec of instruction.recipients) {
    if (!rec.phone) {
      skipped += 1;
      continue;
    }
    const res = await sendInstruction(rec.phone, input.title, input.body, fromName);
    await prisma.opsInstructionRecipient.update({
      where: { id: rec.id },
      data: {
        deliveryStatus: res.ok ? "sent" : "failed",
        sentAt: now,
        providerMessageId: res.messageId ?? null,
        error: res.ok ? null : res.error ?? "send failed",
      },
    });
    if (res.ok) sent += 1;
    else failed += 1;
  }

  return { id: instruction.id, total: instruction.recipients.length, sent, failed, skipped };
}

export interface InstructionScope {
  userId: string;
  role: string;
}

function isAdminRole(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// OWNER/ADMIN see every instruction; a MANAGER sees the ones they authored.
function scopeWhere(scope: InstructionScope): Prisma.OpsInstructionWhereInput {
  return isAdminRole(scope.role) ? {} : { createdByUserId: scope.userId };
}

// Instructions (in scope) still waiting on at least one delivered recipient to
// acknowledge — the workspace tab's attention badge.
export async function countPendingInstructions(scope: InstructionScope): Promise<number> {
  return prisma.opsInstruction.count({
    where: { ...scopeWhere(scope), recipients: { some: { ackedAt: null, deliveryStatus: "sent" } } },
  });
}

export interface InstructionListItem {
  id: string;
  title: string;
  body: string;
  severity: string;
  audienceLabel: string;
  createdByName: string | null;
  createdAt: string;
  total: number;
  acked: number;
  delivered: number; // sent (reached WhatsApp), regardless of ack
  pending: number; // recipients who haven't acked yet
}

export async function listInstructions(scope: InstructionScope, limit = 50): Promise<InstructionListItem[]> {
  const rows = await prisma.opsInstruction.findMany({
    where: scopeWhere(scope),
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { recipients: { select: { ackedAt: true, deliveryStatus: true } } },
  });

  const creatorIds = Array.from(new Set(rows.map((r) => r.createdByUserId)));
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, fullName: true } })
    : [];
  const nameOf = (id: string) => {
    const u = creators.find((x) => x.id === id);
    return u ? u.fullName || u.name : null;
  };

  return rows.map((r) => {
    const total = r.recipients.length;
    const acked = r.recipients.filter((x) => x.ackedAt).length;
    const delivered = r.recipients.filter((x) => x.deliveryStatus === "sent").length;
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      severity: r.severity,
      audienceLabel: ((r.audience as { label?: string } | null)?.label) ?? "",
      createdByName: nameOf(r.createdByUserId),
      createdAt: r.createdAt.toISOString(),
      total,
      acked,
      delivered,
      pending: total - acked,
    };
  });
}

export interface InstructionRecipientView {
  id: string;
  name: string;
  phone: string | null;
  deliveryStatus: string;
  sentAt: string | null;
  ackedAt: string | null;
  error: string | null;
}

export interface InstructionDetail extends InstructionListItem {
  recipients: InstructionRecipientView[];
}

export async function getInstruction(id: string, scope: InstructionScope): Promise<InstructionDetail | null> {
  const r = await prisma.opsInstruction.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { recipients: { orderBy: { name: "asc" } } },
  });
  if (!r) return null;
  const creator = await prisma.user.findUnique({
    where: { id: r.createdByUserId },
    select: { name: true, fullName: true },
  });
  const total = r.recipients.length;
  const acked = r.recipients.filter((x) => x.ackedAt).length;
  const delivered = r.recipients.filter((x) => x.deliveryStatus === "sent").length;
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    severity: r.severity,
    audienceLabel: ((r.audience as { label?: string } | null)?.label) ?? "",
    createdByName: creator ? creator.fullName || creator.name : null,
    createdAt: r.createdAt.toISOString(),
    total,
    acked,
    delivered,
    pending: total - acked,
    recipients: r.recipients.map((x) => ({
      id: x.id,
      name: x.name,
      phone: x.phone,
      deliveryStatus: x.deliveryStatus,
      sentAt: x.sentAt ? x.sentAt.toISOString() : null,
      ackedAt: x.ackedAt ? x.ackedAt.toISOString() : null,
      error: x.error,
    })),
  };
}

// Authorise a mutation (nudge): OWNER/ADMIN, or the author. null = not found.
export async function getInstructionAuthor(id: string): Promise<{ createdByUserId: string } | null> {
  return prisma.opsInstruction.findUnique({ where: { id }, select: { createdByUserId: true } });
}

// Re-send to recipients who have a phone but haven't acked yet. Returns how many
// were re-pinged. `fromName` is re-resolved from the author for the message.
export async function nudgePendingRecipients(id: string): Promise<{ nudged: number }> {
  const instruction = await prisma.opsInstruction.findUnique({
    where: { id },
    select: {
      title: true,
      body: true,
      createdByUserId: true,
      recipients: { where: { ackedAt: null, phone: { not: null } }, select: { id: true, phone: true } },
    },
  });
  if (!instruction) return { nudged: 0 };
  const author = await prisma.user.findUnique({
    where: { id: instruction.createdByUserId },
    select: { name: true, fullName: true },
  });
  const fromName = author?.fullName || author?.name || "Management";

  const now = new Date();
  let nudged = 0;
  for (const rec of instruction.recipients) {
    if (!rec.phone) continue;
    const res = await sendInstruction(rec.phone, instruction.title, instruction.body, fromName);
    await prisma.opsInstructionRecipient.update({
      where: { id: rec.id },
      data: {
        deliveryStatus: res.ok ? "sent" : "failed",
        sentAt: now,
        providerMessageId: res.messageId ?? null,
        error: res.ok ? null : res.error ?? "send failed",
      },
    });
    if (res.ok) nudged += 1;
  }
  return { nudged };
}

// Mark a single recipient acked from the workspace (e.g. owner confirms verbally).
export async function ackRecipient(recipientId: string): Promise<void> {
  await prisma.opsInstructionRecipient.update({
    where: { id: recipientId },
    data: { ackedAt: new Date() },
  });
}

// Inbound ack: a recipient replying OK/DONE/noted flips ALL their still-pending
// instruction rows to acked. Returns null when not an ack / no matching pending
// recipient. Never throws — caller logs.
export async function handleInstructionAck(from: string, text: string): Promise<{ acked: number } | null> {
  if (!from || !ACK_SOFT.test(text)) return null;

  // Pull recent un-acked recipients with a phone and match by last-9 digits.
  const pending = await prisma.opsInstructionRecipient.findMany({
    where: { ackedAt: null, phone: { not: null } },
    select: { id: true, phone: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const mine = pending.filter((r) => r.phone && samePhone(from, r.phone)).map((r) => r.id);
  if (mine.length === 0) return null;

  const res = await prisma.opsInstructionRecipient.updateMany({
    where: { id: { in: mine } },
    data: { ackedAt: new Date() },
  });
  return { acked: res.count };
}
