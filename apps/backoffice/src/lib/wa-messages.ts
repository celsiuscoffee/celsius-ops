// Persistence + queries for the Ops chat inbox (/ops/chat-inbox).
//
// The WhatsApp webhook (inbound staff replies) and the ops-pulse sender
// (outbound digests / escalations / ad-hoc replies) previously only logged to
// console. This module persists BOTH directions into WaMessage so the owner can
// monitor the two-way thread. All write helpers are best-effort by contract —
// callers wrap them so a DB hiccup never breaks a webhook 200 or a live send.

import { prisma } from "@/lib/prisma";

// Our own WhatsApp business number — shown as the non-staff side of a thread.
// Display-only (threading keys on the staff phone), so a fallback label is fine.
const BUSINESS = process.env.WHATSAPP_DISPLAY_NUMBER || "business";

const WINDOW_MS = 24 * 60 * 60 * 1000; // WhatsApp free-form customer-service window

export function digitsOnly(s: string): string {
  return (s || "").replace(/[^0-9]/g, "");
}

// Canonical thread key for a Malaysian mobile: "60" + the last 9 significant
// digits. Collapses the formats we see — Meta inbound "60123456789", stored
// "+60123456789", local "0123456789" — onto ONE key so a person is one thread.
export function canonicalPhone(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length < 9) return d;
  return "60" + d.slice(-9);
}

// Tolerant compare on the last 9 digits — the same uniqueness the ack handler
// uses, because stored User.phone values vary in format.
export function samePhone(a: string, b: string): boolean {
  const x = digitsOnly(a);
  const y = digitsOnly(b);
  if (x.length < 8 || y.length < 8) return false;
  const n = Math.min(9, x.length, y.length);
  return x.slice(-n) === y.slice(-n);
}

// Resolve a phone to a staff User.id. The User table is small (internal staff),
// so we load candidates with a phone set and match on the last 9 digits.
export async function resolveUserIdByPhone(phone: string): Promise<string | null> {
  const users = await prisma.user.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true },
  });
  const hit = users.find((u) => u.phone && samePhone(phone, u.phone));
  return hit?.id ?? null;
}

// ─── write paths ─────────────────────────────────────────────────────────

export interface RecordInboundInput {
  from: string; // staff phone (Meta intl digits)
  waMessageId?: string; // wamid.*
  type?: string;
  body: string;
  at?: Date; // Meta event time
}

export async function recordInbound(input: RecordInboundInput): Promise<void> {
  const staffPhone = canonicalPhone(input.from);
  const userId = await resolveUserIdByPhone(input.from);
  const data = {
    direction: "IN",
    waMessageId: input.waMessageId ?? null,
    staffPhone,
    userId,
    fromPhone: digitsOnly(input.from),
    toPhone: BUSINESS,
    body: input.body,
    type: input.type ?? "text",
    status: "received",
    sentAt: input.at ?? new Date(),
  };
  // Meta can redeliver the same message id — upsert keeps ingestion idempotent.
  if (input.waMessageId) {
    await prisma.waMessage.upsert({
      where: { waMessageId: input.waMessageId },
      create: data,
      update: {},
    });
  } else {
    await prisma.waMessage.create({ data });
  }
}

export interface RecordOutboundInput {
  to: string; // staff phone
  body: string;
  templateName?: string;
  ok: boolean;
  waMessageId?: string;
  error?: string;
  opsAlertId?: string;
}

export async function recordOutbound(input: RecordOutboundInput): Promise<void> {
  const staffPhone = canonicalPhone(input.to);
  const userId = await resolveUserIdByPhone(input.to);
  await prisma.waMessage.create({
    data: {
      direction: "OUT",
      waMessageId: input.waMessageId ?? null,
      staffPhone,
      userId,
      fromPhone: BUSINESS,
      toPhone: digitsOnly(input.to),
      body: input.body,
      type: input.templateName ? "template" : "text",
      templateName: input.templateName ?? null,
      status: input.ok ? "sent" : "failed",
      error: input.error ?? null,
      opsAlertId: input.opsAlertId ?? null,
      sentAt: new Date(),
    },
  });
}

// Meta delivery receipts (sent → delivered → read, or failed). Advance the OUT
// row matched by wamid. No-op if we never recorded that message.
export async function updateOutboundStatus(waMessageId: string, status: string): Promise<void> {
  await prisma.waMessage.updateMany({ where: { waMessageId }, data: { status } });
}

// Is the recipient's 24h free-form window open? True when their last INBOUND
// message arrived within the last 24h (only then may we send free-form text).
export async function isWindowOpen(staffPhoneRaw: string, now: Date): Promise<boolean> {
  const staffPhone = canonicalPhone(staffPhoneRaw);
  const lastInbound = await prisma.waMessage.findFirst({
    where: { staffPhone, direction: "IN" },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  return !!lastInbound && now.getTime() - lastInbound.sentAt.getTime() < WINDOW_MS;
}

// ─── read paths ──────────────────────────────────────────────────────────

export interface ThreadSummary {
  staffPhone: string;
  userId: string | null;
  name: string | null;
  role: string | null;
  lastBody: string;
  lastDirection: string;
  lastAt: string;
  windowOpen: boolean;
  awaitingReply: boolean; // latest message is inbound → needs owner's attention
  openAlerts: number;
  messageCount: number;
}

export async function listThreads(now: Date): Promise<ThreadSummary[]> {
  // Internal volume is low — pull the recent slice and fold per-thread in JS,
  // which keeps this to a few batched queries instead of N+1 per conversation.
  const recent = await prisma.waMessage.findMany({
    orderBy: { sentAt: "desc" },
    take: 2000,
    select: { staffPhone: true, userId: true, body: true, direction: true, sentAt: true },
  });

  type Acc = {
    staffPhone: string;
    userId: string | null;
    lastBody: string;
    lastDirection: string;
    lastAt: Date;
    lastInboundAt: Date | null;
    count: number;
  };
  const byPhone = new Map<string, Acc>();
  for (const m of recent) {
    let acc = byPhone.get(m.staffPhone);
    if (!acc) {
      acc = {
        staffPhone: m.staffPhone,
        userId: m.userId,
        lastBody: m.body,
        lastDirection: m.direction,
        lastAt: m.sentAt,
        lastInboundAt: null,
        count: 0,
      };
      byPhone.set(m.staffPhone, acc);
    }
    acc.count++;
    if (m.userId && !acc.userId) acc.userId = m.userId;
    if (m.direction === "IN" && !acc.lastInboundAt) acc.lastInboundAt = m.sentAt; // newest first
  }

  const accs = [...byPhone.values()];
  if (accs.length === 0) return [];

  // Names for known users + open-alert counts, two batched queries.
  const userIds = [...new Set(accs.map((a) => a.userId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, role: true } })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const alertRows = userIds.length
    ? await prisma.opsAlert.groupBy({
        by: ["assigneeUserId"],
        where: { assigneeUserId: { in: userIds }, status: { in: ["OPEN", "ESCALATED"] } },
        _count: { _all: true },
      })
    : [];
  const alertMap = new Map(alertRows.map((r) => [r.assigneeUserId, r._count._all]));

  const threads = accs.map((a) => {
    const u = a.userId ? userMap.get(a.userId) : undefined;
    const windowOpen = !!a.lastInboundAt && now.getTime() - a.lastInboundAt.getTime() < WINDOW_MS;
    return {
      staffPhone: a.staffPhone,
      userId: a.userId,
      name: u?.name ?? null,
      role: u?.role ?? null,
      lastBody: a.lastBody,
      lastDirection: a.lastDirection,
      lastAt: a.lastAt.toISOString(),
      windowOpen,
      awaitingReply: a.lastDirection === "IN",
      openAlerts: (a.userId ? alertMap.get(a.userId) : 0) || 0,
      messageCount: a.count,
    };
  });
  threads.sort((x, y) => (x.lastAt < y.lastAt ? 1 : -1)); // newest activity first
  return threads;
}

export interface ThreadDetail {
  staffPhone: string;
  userId: string | null;
  name: string | null;
  role: string | null;
  windowOpen: boolean;
  openAlerts: { id: string; signal: string; severity: string; summary: string; status: string; sentAt: string | null }[];
  messages: {
    id: string;
    direction: string;
    body: string;
    type: string;
    templateName: string | null;
    status: string | null;
    error: string | null;
    sentAt: string;
  }[];
}

export async function getThread(staffPhoneRaw: string, now: Date): Promise<ThreadDetail | null> {
  const staffPhone = canonicalPhone(staffPhoneRaw);
  const messages = await prisma.waMessage.findMany({
    where: { staffPhone },
    orderBy: { sentAt: "asc" },
    take: 500,
    select: {
      id: true,
      direction: true,
      body: true,
      type: true,
      templateName: true,
      status: true,
      error: true,
      sentAt: true,
      userId: true,
    },
  });
  if (messages.length === 0) return null;

  const userId = messages.find((m) => m.userId)?.userId ?? null;
  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true } })
    : null;

  const lastInbound = [...messages].reverse().find((m) => m.direction === "IN");
  const windowOpen = !!lastInbound && now.getTime() - lastInbound.sentAt.getTime() < WINDOW_MS;

  const alerts = userId
    ? await prisma.opsAlert.findMany({
        where: { assigneeUserId: userId, status: { in: ["OPEN", "ESCALATED"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, signal: true, severity: true, summary: true, status: true, sentAt: true },
      })
    : [];

  return {
    staffPhone,
    userId,
    name: user?.name ?? null,
    role: user?.role ?? null,
    windowOpen,
    openAlerts: alerts.map((a) => ({
      id: a.id,
      signal: a.signal,
      severity: a.severity,
      summary: a.summary,
      status: a.status,
      sentAt: a.sentAt ? a.sentAt.toISOString() : null,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body,
      type: m.type,
      templateName: m.templateName,
      status: m.status,
      error: m.error,
      sentAt: m.sentAt.toISOString(),
    })),
  };
}
