// Ops chat inbox — a STAFF-oriented view over the shared WhatsApp message store
// (lib/whatsapp-store.ts → the WhatsAppMessage table). The supplier-chat inbox
// folds that same table into threads by supplier; this folds it by staff member:
// every inbound staff reply and every outbound ops-pulse digest, threaded on the
// staff phone, with ack/alert context and a 24h-window-gated reply.
//
// Read-only here. Writes go through whatsapp-store: recordInboundMessage (the
// webhook) and recordOutboundMessage (the ops-pulse sender + inbox replies).

import { prisma } from "@/lib/prisma";

const WINDOW_MS = 24 * 60 * 60 * 1000; // WhatsApp free-form customer-service window

export function digitsOnly(s: string): string {
  return (s || "").replace(/[^0-9]/g, "");
}

// Canonical thread key for a Malaysian mobile: "60" + the last 9 significant
// digits. Collapses "60123456789" / "+60123456789" / "0123456789" onto ONE key.
export function canonicalPhone(raw: string): string {
  const d = digitsOnly(raw);
  return d.length < 9 ? d : "60" + d.slice(-9);
}

function last9(raw: string): string {
  return digitsOnly(raw).slice(-9);
}

// The staff side of a message (the counterparty to our business number).
function staffSide(m: { direction: string; fromNumber: string; toNumber: string }): string {
  return m.direction === "inbound" ? m.fromNumber : m.toNumber;
}

type StaffUser = { id: string; name: string; role: string; outletId: string | null };

// Staff are a small set; load those with a phone and key them by canonical phone
// so we can tell which threads belong to staff (vs suppliers / unknown numbers).
// Prefer fullName so the inbox shows the real name, not a short handle.
async function loadStaffByCanonical(): Promise<Map<string, StaffUser>> {
  const users = await prisma.user.findMany({
    where: { phone: { not: null } },
    select: { id: true, name: true, fullName: true, role: true, phone: true, outletId: true },
  });
  const map = new Map<string, StaffUser>();
  for (const u of users) {
    if (u.phone) map.set(canonicalPhone(u.phone), { id: u.id, name: u.fullName || u.name, role: u.role, outletId: u.outletId });
  }
  return map;
}

export interface ThreadSummary {
  staffPhone: string;
  userId: string | null;
  name: string | null;
  role: string | null;
  outletId: string | null;
  outletName: string | null;
  lastBody: string;
  lastDirection: string; // IN | OUT
  lastAt: string;
  windowOpen: boolean;
  awaitingReply: boolean; // latest message is inbound → needs the owner's attention
  openAlerts: number;
  messageCount: number;
}

export async function listThreads(now: Date): Promise<ThreadSummary[]> {
  const [rows, staffByCanon] = await Promise.all([
    prisma.whatsAppMessage.findMany({
      orderBy: { timestamp: "desc" },
      take: 2000,
      select: { direction: true, fromNumber: true, toNumber: true, body: true, type: true, timestamp: true },
    }),
    loadStaffByCanonical(),
  ]);

  type Acc = {
    staffPhone: string;
    lastBody: string;
    lastDirection: string;
    lastAt: Date;
    lastInboundAt: Date | null;
    count: number;
  };
  const byPhone = new Map<string, Acc>();
  for (const m of rows) {
    const key = canonicalPhone(staffSide(m));
    // Ops inbox = staff threads only; suppliers / unknown numbers are out of scope
    // (the supplier-chat inbox covers those over the same store).
    if (!staffByCanon.has(key)) continue;
    let acc = byPhone.get(key);
    if (!acc) {
      acc = {
        staffPhone: key,
        lastBody: m.body ?? `[${m.type}]`,
        lastDirection: m.direction,
        lastAt: m.timestamp,
        lastInboundAt: null,
        count: 0,
      };
      byPhone.set(key, acc);
    }
    acc.count++;
    if (m.direction === "inbound" && !acc.lastInboundAt) acc.lastInboundAt = m.timestamp; // newest first
  }

  const accs = [...byPhone.values()];
  if (accs.length === 0) return [];

  const userIds = accs.map((a) => staffByCanon.get(a.staffPhone)!.id);
  const outletIds = [...new Set(accs.map((a) => staffByCanon.get(a.staffPhone)!.outletId).filter(Boolean) as string[])];
  const [alertRows, outlets] = await Promise.all([
    prisma.opsAlert.groupBy({
      by: ["assigneeUserId"],
      where: { assigneeUserId: { in: userIds }, status: { in: ["OPEN", "ESCALATED"] } },
      _count: { _all: true },
    }),
    outletIds.length ? prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } }) : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const alertMap = new Map(alertRows.map((r) => [r.assigneeUserId, r._count._all]));
  const outletNameById = new Map(outlets.map((o) => [o.id, o.name]));

  const threads = accs.map((a) => {
    const u = staffByCanon.get(a.staffPhone)!;
    const windowOpen = !!a.lastInboundAt && now.getTime() - a.lastInboundAt.getTime() < WINDOW_MS;
    return {
      staffPhone: a.staffPhone,
      userId: u.id,
      name: u.name,
      role: u.role,
      outletId: u.outletId,
      outletName: u.outletId ? outletNameById.get(u.outletId) ?? null : null,
      lastBody: a.lastBody,
      lastDirection: a.lastDirection === "inbound" ? "IN" : "OUT",
      lastAt: a.lastAt.toISOString(),
      windowOpen,
      awaitingReply: a.lastDirection === "inbound",
      openAlerts: alertMap.get(u.id) || 0,
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
  outletName: string | null;
  windowOpen: boolean;
  openAlerts: { id: string; signal: string; severity: string; summary: string; status: string; sentAt: string | null }[];
  messages: {
    id: string;
    direction: string; // IN | OUT
    body: string;
    type: string;
    templateName: string | null;
    status: string | null;
    error: string | null;
    sentAt: string;
  }[];
}

export async function getThread(staffPhoneRaw: string, now: Date): Promise<ThreadDetail | null> {
  const canon = canonicalPhone(staffPhoneRaw);
  const tail = last9(canon);

  // endsWith(last9) narrows the scan to this number; the post-filter on the
  // canonical staff side drops any row that merely shares trailing digits.
  const rows = await prisma.whatsAppMessage.findMany({
    where: { OR: [{ fromNumber: { endsWith: tail } }, { toNumber: { endsWith: tail } }] },
    orderBy: { timestamp: "asc" },
    take: 500,
    select: {
      id: true,
      direction: true,
      fromNumber: true,
      toNumber: true,
      body: true,
      type: true,
      status: true,
      timestamp: true,
    },
  });
  const mine = rows.filter((m) => canonicalPhone(staffSide(m)) === canon);
  if (mine.length === 0) return null;

  // Match staff by CANONICAL phone, not raw endsWith — stored phones may be
  // formatted ("011-28429710"), so a digits-only endsWith on the raw string
  // misses them (the bug that showed the bare number instead of the name).
  const staff = await loadStaffByCanonical();
  const user = staff.get(canon) ?? null;
  const outlet = user?.outletId
    ? await prisma.outlet.findUnique({ where: { id: user.outletId }, select: { name: true } })
    : null;

  const lastInbound = [...mine].reverse().find((m) => m.direction === "inbound");
  const windowOpen = !!lastInbound && now.getTime() - lastInbound.timestamp.getTime() < WINDOW_MS;

  const alerts = user
    ? await prisma.opsAlert.findMany({
        where: { assigneeUserId: user.id, status: { in: ["OPEN", "ESCALATED"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, signal: true, severity: true, summary: true, status: true, sentAt: true },
      })
    : [];

  return {
    staffPhone: canon,
    userId: user?.id ?? null,
    name: user?.name ?? null,
    role: user?.role ?? null,
    outletName: outlet?.name ?? null,
    windowOpen,
    openAlerts: alerts.map((a) => ({
      id: a.id,
      signal: a.signal,
      severity: a.severity,
      summary: a.summary,
      status: a.status,
      sentAt: a.sentAt ? a.sentAt.toISOString() : null,
    })),
    messages: mine.map((m) => ({
      id: m.id,
      direction: m.direction === "inbound" ? "IN" : "OUT",
      body: m.body ?? `[${m.type}]`,
      type: m.type,
      templateName: null,
      status: m.status,
      error: null,
      sentAt: m.timestamp.toISOString(),
    })),
  };
}

// Is the recipient's 24h free-form window open? True when their last INBOUND
// message arrived within the last 24h (only then may we send free-form text).
export async function isWindowOpen(staffPhoneRaw: string, now: Date): Promise<boolean> {
  const tail = last9(canonicalPhone(staffPhoneRaw));
  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where: { direction: "inbound", fromNumber: { endsWith: tail } },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  return !!lastInbound && now.getTime() - lastInbound.timestamp.getTime() < WINDOW_MS;
}
