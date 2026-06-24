// Routes a breach to the accountable human. The design holds the *manager*
// in check, so we page the MANAGER who owns the outlet, with the OWNER as the
// escalation fallback when no outlet-matched manager exists.
//
// NOTE: the schema has no outlet→manager mapping (no Outlet.managerId / region
// hierarchy), so we match on User.outletId / outletIds. With a single ops
// manager today this is exact; add a mapping before a second manager joins.

import { prisma } from "@/lib/prisma";
import type { Assignee } from "./types";

export async function resolveAssignee(outletId: string): Promise<Assignee | null> {
  const manager = await prisma.user.findFirst({
    where: {
      role: "MANAGER",
      status: "ACTIVE",
      OR: [{ outletId }, { outletIds: { has: outletId } }],
    },
    select: { id: true, name: true, phone: true, role: true },
  });
  if (manager) {
    return { userId: manager.id, name: manager.name, phone: manager.phone, role: manager.role, fallback: false };
  }
  // No outlet-matched manager → fall back to the owner (also the escalation target).
  const owner = await resolveOwner();
  return owner ? { ...owner, fallback: true } : null;
}

// The owner — escalation target and last-resort assignee.
export async function resolveOwner(): Promise<Assignee | null> {
  const owner = await prisma.user.findFirst({
    where: { role: "OWNER", status: "ACTIVE" },
    select: { id: true, name: true, phone: true, role: true },
  });
  if (!owner) return null;
  return { userId: owner.id, name: owner.name, phone: owner.phone, role: owner.role, fallback: false };
}
