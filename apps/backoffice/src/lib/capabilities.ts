// Named capabilities: a narrow grant of ONE elevated action to a non-admin.
//
// The role ladder (OWNER > ADMIN > MANAGER > STAFF) is coarse. Several
// guards — unpublishing a roster, retro-editing a published week, cancelling
// an already-approved leave — are gated on OWNER/ADMIN because they rewrite
// something staff were already told about (or already paid for). A head of
// operations legitimately needs those, but promoting them to ADMIN would also
// hand over payroll, bank files, finance and every employee's bank details,
// since ADMIN bypasses `hasModuleAccess` outright across ~120 routes.
//
// So: keep the role, grant the specific action. Stored on the existing
// `User.permissions` string[] (present on the schema since the first
// migration and never read until now — no migration needed).
//
// These are ELEVATIONS, not the primary gate. A capability lets someone past
// the owner/admin check on an action their role + moduleAccess already lets
// them reach: `hr:schedules` still gates the roster routes, outlet scoping
// still applies. Granting `roster:unpublish` to someone with no schedule
// access changes nothing.

import { prisma } from "@/lib/prisma";

export const CAPABILITIES = {
  "roster:unpublish":
    "Unpublish a published roster (staff have already been notified)",
  "roster:retro_edit":
    "Edit a published roster on a date that has already passed (rewrites pay basis)",
  "leave:cancel_approved":
    "Cancel an already-approved leave request and return the days to the balance",
} as const;

export type Capability = keyof typeof CAPABILITIES;

export const ALL_CAPABILITIES = Object.keys(CAPABILITIES) as Capability[];

export function isCapability(value: string): value is Capability {
  return (ALL_CAPABILITIES as string[]).includes(value);
}

// Same 60s per-instance cache as the account-state check in lib/auth.ts: a
// grant or revoke takes effect within a minute, and the guards don't add a DB
// round trip to every request.
const TTL_MS = 60_000;
const cache = new Map<string, { caps: string[]; checkedAt: number }>();

/** Drop a user's cached grants — call after writing their permissions. */
export function invalidateCapabilities(userId: string) {
  cache.delete(userId);
}

async function grantsFor(userId: string): Promise<string[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.checkedAt < TTL_MS) return hit.caps;
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { permissions: true },
    });
    const caps = row?.permissions ?? [];
    cache.set(userId, { caps, checkedAt: Date.now() });
    return caps;
  } catch {
    // Database unreachable: fall back to the last known grants, else none.
    // Failing CLOSED here is correct — these guards protect already-paid work.
    return hit?.caps ?? [];
  }
}

/**
 * Can this session perform the elevated action?
 *
 * OWNER/ADMIN always can (unchanged behaviour). Anyone else needs the explicit
 * grant on their user row.
 */
export async function can(
  session: { id: string; role: string },
  capability: Capability,
): Promise<boolean> {
  if (session.role === "OWNER" || session.role === "ADMIN") return true;
  const caps = await grantsFor(session.id);
  return caps.includes(capability);
}

/** Every capability this session effectively holds (for UI + API echoes). */
export async function capabilitiesFor(
  session: { id: string; role: string },
): Promise<Capability[]> {
  if (session.role === "OWNER" || session.role === "ADMIN") return [...ALL_CAPABILITIES];
  const caps = await grantsFor(session.id);
  return ALL_CAPABILITIES.filter((c) => caps.includes(c));
}
