// Routes a breach to the accountable people by DISCIPLINE (routeKey), not by
// outlet→manager. Operations/procurement → ops leads; barista/kitchen → the
// discipline lead. Recipient names come from config (RECIPIENTS) and resolve to
// active users; unresolved names fall back to the owner so nothing is dropped.

import { prisma } from "@/lib/prisma";
import { RECIPIENTS } from "./config";
import type { Assignee, RouteKey } from "./types";

// Resolve a discipline's configured recipient names to active users. First
// configured name = primary (owns the ledger row's ack/escalation); the rest are
// co-recipients. Unmatched names are logged and skipped; if none resolve, falls
// back to the owner.
export async function resolveRecipients(routeKey: RouteKey): Promise<Assignee[]> {
  const names = RECIPIENTS[routeKey] ?? [];
  if (names.length === 0) return ownerFallback(routeKey);

  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, phone: true, role: true },
  });
  const byName = new Map<string, (typeof users)[number]>();
  for (const u of users) byName.set(u.name.trim().toLowerCase(), u);

  const matched: Assignee[] = [];
  for (const n of names) {
    const u = byName.get(n.trim().toLowerCase());
    if (u) matched.push({ userId: u.id, name: u.name, phone: u.phone, role: u.role, fallback: false });
    else console.warn(`[ops-pulse] route "${routeKey}" recipient "${n}" not found among active users — skipped`);
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
