import { hrSupabaseAdmin } from "./supabase";
import { prisma } from "@/lib/prisma";

/**
 * Resolve the set of user_ids a session is allowed to see in HR views.
 *
 * - OWNER / ADMIN: returns null (no scoping — caller should treat as "everyone").
 * - MANAGER: returns the manager's full subtree — direct reports AND
 *   reports-of-reports, walked transitively via `hr_employee_profiles.manager_user_id`.
 *   A manager always sees their entire downstream org, not just level 1.
 *
 * The result does NOT include the session user themselves.
 */
export async function resolveVisibleUserIds(
  session: { role: string; id: string },
): Promise<string[] | null> {
  if (session.role !== "MANAGER") return null;

  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, manager_user_id");

  const childrenByManager = new Map<string, string[]>();
  for (const p of (profiles || []) as { user_id: string; manager_user_id: string | null }[]) {
    if (!p.manager_user_id) continue;
    const list = childrenByManager.get(p.manager_user_id);
    if (list) list.push(p.user_id);
    else childrenByManager.set(p.manager_user_id, [p.user_id]);
  }

  const visited = new Set<string>();
  const queue: string[] = [session.id];
  while (queue.length) {
    const mgr = queue.shift()!;
    for (const child of childrenByManager.get(mgr) || []) {
      if (visited.has(child)) continue; // cycle guard
      visited.add(child);
      queue.push(child);
    }
  }
  return Array.from(visited);
}

/**
 * Resolve the set of outlets a session can access.
 *
 * - OWNER / ADMIN: null (no restriction — all outlets).
 * - MANAGER: union of `User.outletId` (primary) and `User.outletIds` (multi-outlet
 *   assignment). The session cookie only carries the legacy single `outletId`,
 *   so we fetch fresh from Prisma to pick up `outletIds` too.
 * - Any other role: empty list.
 *
 * Use `canAccessOutlet` for single-outlet membership checks.
 */
export async function getAccessibleOutletIds(
  session: { role: string; id: string; outletId: string | null },
): Promise<string[] | null> {
  if (session.role === "OWNER" || session.role === "ADMIN") return null;
  if (session.role !== "MANAGER") return [];

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { outletId: true, outletIds: true },
  });
  const set = new Set<string>();
  if (user?.outletId) set.add(user.outletId);
  for (const id of user?.outletIds || []) set.add(id);
  // Fallback to cookie-level outletId if DB lookup returned nothing
  if (set.size === 0 && session.outletId) set.add(session.outletId);
  return Array.from(set);
}

/** True when the session is allowed to read/write this outlet. */
export async function canAccessOutlet(
  session: { role: string; id: string; outletId: string | null },
  outletId: string,
): Promise<boolean> {
  const allowed = await getAccessibleOutletIds(session);
  if (allowed === null) return true; // OWNER/ADMIN
  return allowed.includes(outletId);
}

/**
 * Check whether a session has the given module permission (e.g. "hr:schedules").
 *
 * OWNER/ADMIN bypass all module checks (match the sidebar's canAccess).
 * Everyone else must have the flat key in their moduleAccess — stored as
 * `{ "hr": ["schedules", ...] }` in the DB and flattened to `"hr:schedules"`.
 *
 * Use for defense-in-depth on API routes where the sidebar already gates
 * navigation but a user could still hit the URL directly.
 */
export async function hasModuleAccess(
  session: { role: string; id: string },
  moduleKey: string,
): Promise<boolean> {
  if (session.role === "OWNER" || session.role === "ADMIN") return true;

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { moduleAccess: true },
  });
  const raw = user?.moduleAccess;
  if (!raw) return false;

  if (Array.isArray(raw)) {
    return (raw as unknown as string[]).includes(moduleKey);
  }
  if (typeof raw === "object") {
    const [app, mod] = moduleKey.split(":");
    const list = (raw as Record<string, unknown>)[app];
    return Array.isArray(list) && (list as string[]).includes(mod);
  }
  return false;
}
