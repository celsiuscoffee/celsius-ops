// Routes a breach to the accountable people by DISCIPLINE (routeKey), not by
// outlet→manager. Operations/procurement → ops leads; barista/kitchen → the
// discipline lead. Recipients come from config (RECIPIENTS): each entry is
// either a User name (resolved to an active user) or a raw phone number (routed
// directly, for people without an app account). Unresolved names fall back to
// the owner so nothing is dropped.

import { prisma } from "@/lib/prisma";
import { RECIPIENTS } from "./config";
import type { Assignee, RouteKey } from "./types";

// A config entry that is a phone number (+60…, 01…) rather than a user name.
function isPhoneEntry(s: string): boolean {
  return /^\+?[0-9][0-9\s-]{6,}$/.test(s.trim());
}

// Resolve a discipline's configured recipients. First entry = primary (owns the
// ledger row's ack/escalation); the rest co-receive the digest. Phone entries
// route directly (no User, no ack attribution). Unmatched names are logged; if
// nothing resolves, falls back to the owner.
export async function resolveRecipients(routeKey: RouteKey): Promise<Assignee[]> {
  const entries = RECIPIENTS[routeKey] ?? [];
  if (entries.length === 0) return ownerFallback(routeKey);

  const matched: Assignee[] = [];
  const nameEntries: string[] = [];
  for (const e of entries) {
    if (isPhoneEntry(e)) {
      matched.push({ userId: "", name: e, phone: e.trim(), role: "external", fallback: false });
    } else {
      nameEntries.push(e);
    }
  }

  if (nameEntries.length > 0) {
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, phone: true, role: true },
    });
    const byName = new Map<string, (typeof users)[number]>();
    for (const u of users) byName.set(u.name.trim().toLowerCase(), u);
    for (const n of nameEntries) {
      const u = byName.get(n.trim().toLowerCase());
      if (u) matched.push({ userId: u.id, name: u.name, phone: u.phone, role: u.role, fallback: false });
      else console.warn(`[ops-pulse] route "${routeKey}" recipient "${n}" not found among active users — skipped`);
    }
  }

  if (matched.length === 0) return ownerFallback(routeKey);
  return matched;
}

async function ownerFallback(routeKey: string): Promise<Assignee[]> {
  const owner = await resolveOwner();
  if (!owner) return [];
  console.warn(`[ops-pulse] route "${routeKey}" had no resolvable recipients — falling back to owner`);
  return [{ ...owner, fallback: true }];
}

// The owner — escalation target and last-resort recipient.
export async function resolveOwner(): Promise<Assignee | null> {
  const owner = await prisma.user.findFirst({
    where: { role: "OWNER", status: "ACTIVE" },
    select: { id: true, name: true, phone: true, role: true },
  });
  if (!owner) return null;
  return { userId: owner.id, name: owner.name, phone: owner.phone, role: owner.role, fallback: false };
}

// The on-shift OUTLET TEAM today — staff on a published shift at this outlet, for
// work the team itself does (e.g. stock take). Resolved to active users with a
// phone. Empty when no roster is published for the outlet today.
export async function resolveOutletTeam(outletId: string, now: Date): Promise<Assignee[]> {
  if (!outletId) return [];
  const ymd = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const rows = await prisma.$queryRaw<Array<{ user_id: string | null }>>`
    SELECT DISTINCT s.user_id
    FROM hr_schedule_shifts s
    JOIN hr_schedules sch ON sch.id = s.schedule_id
    WHERE sch.outlet_id = ${outletId}
      AND sch.published_at IS NOT NULL
      AND s.shift_date = ${ymd}::date
  `;
  const ids = rows.map((r) => r.user_id).filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, status: "ACTIVE", phone: { not: null } },
    select: { id: true, name: true, phone: true, role: true },
  });
  return users.map((u) => ({ userId: u.id, name: u.name, phone: u.phone, role: u.role, fallback: false }));
}

// The OUTLET's SUPERVISORS / LEADS — active staff whose HR position is
// "Supervisor" or any "…Lead" (Shift Lead, Barista Lead, Kitchen Lead) at this
// outlet, with a phone. Used for work the shift lead owns (e.g. stock counts) so
// the message goes to the leads, not the whole floor team. Empty when the outlet
// has no supervisor/lead assigned (the manager digest is the backstop).
export async function resolveOutletSupervisors(outletId: string): Promise<Assignee[]> {
  if (!outletId) return [];
  const users = await prisma.$queryRaw<Array<{ id: string; name: string; phone: string | null; role: string }>>`
    SELECT u.id, u.name, u.phone, u.role
    FROM "User" u
    JOIN hr_employee_profiles p ON p.user_id = u.id
    WHERE u."outletId" = ${outletId}
      AND u.status = 'ACTIVE'
      AND u.phone IS NOT NULL
      AND (p.position = 'Supervisor' OR p.position ILIKE '%lead%')
  `;
  return users.map((u) => ({ userId: u.id, name: u.name, phone: u.phone, role: u.role, fallback: false }));
}
