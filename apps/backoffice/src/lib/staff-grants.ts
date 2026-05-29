import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";

export type ModuleAccessMap = Record<string, string[]>;

// Restrict the apps/modules a MANAGER may assign to a Staff member to a subset
// of the manager's own grants — a manager can't hand out access they don't
// themselves hold. OWNER/ADMIN are unrestricted.
//
// Mirrors the sidebar RBAC's "empty moduleAccess = full access" rule: a manager
// with no module restrictions can still grant any module. appAccess is always
// clamped to the manager's own apps (an admin provisions broader app access).
//
// Only the keys present in the request are returned, so callers can spread the
// result over a partial update.
export async function clampGrantsToCaller(
  caller: SessionUser,
  requestedAppAccess: string[] | undefined,
  requestedModuleAccess: ModuleAccessMap | undefined,
): Promise<{ appAccess?: string[]; moduleAccess?: ModuleAccessMap }> {
  const out: { appAccess?: string[]; moduleAccess?: ModuleAccessMap } = {};
  if (requestedAppAccess !== undefined) out.appAccess = requestedAppAccess;
  if (requestedModuleAccess !== undefined) out.moduleAccess = requestedModuleAccess;

  // Owners/admins grant freely.
  if (caller.role === "OWNER" || caller.role === "ADMIN") return out;

  const row = await prisma.user.findUnique({
    where: { id: caller.id },
    select: { appAccess: true, moduleAccess: true },
  });
  const callerApps = row?.appAccess ?? [];
  const callerModules: ModuleAccessMap =
    row?.moduleAccess && typeof row.moduleAccess === "object" && !Array.isArray(row.moduleAccess)
      ? (row.moduleAccess as ModuleAccessMap)
      : {};

  if (requestedAppAccess !== undefined) {
    out.appAccess = requestedAppAccess.filter((a) => callerApps.includes(a));
  }

  if (requestedModuleAccess !== undefined) {
    // Empty moduleAccess on the manager = full access (sidebar RBAC rule) — no clamp.
    if (Object.keys(callerModules).length === 0) {
      out.moduleAccess = requestedModuleAccess;
    } else {
      const clamped: ModuleAccessMap = {};
      for (const [app, keys] of Object.entries(requestedModuleAccess)) {
        const allowed = callerModules[app];
        if (!Array.isArray(allowed)) continue; // manager doesn't have this app at all
        clamped[app] = (keys ?? []).filter((k) => allowed.includes(k));
      }
      out.moduleAccess = clamped;
    }
  }

  return out;
}
