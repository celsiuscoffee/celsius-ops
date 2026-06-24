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
