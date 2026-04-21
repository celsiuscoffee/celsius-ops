/**
 * Module-access helpers for the staff app.
 *
 * Single source of truth for:
 *   - whether a user can see a given moduleKey
 *   - which moduleKey gates which page
 *
 * Used by the bottom nav, the (ops) layout route guard, the home Quick
 * Actions filter, and any other UI that needs to hide content the user
 * isn't authorized for. Server endpoints still validate independently
 * (see e.g. /api/wastage outlet check) — this is a UX layer, not a
 * security boundary.
 */

export type UserRoleLite = string | undefined;
export type ModuleAccess = Record<string, unknown> | undefined;

export function hasAccess(
  role: UserRoleLite,
  moduleAccess: ModuleAccess,
  moduleKey: string | undefined,
): boolean {
  if (!moduleKey) return true;
  if (role === "OWNER" || role === "ADMIN") return true;
  if (!moduleAccess) return false;

  if (moduleKey.includes(":")) {
    const [app, mod] = moduleKey.split(":");
    const appAccess = moduleAccess[app];
    if (appAccess === true) return true;
    if (Array.isArray(appAccess)) return appAccess.includes(mod);
    return false;
  }

  const appAccess = moduleAccess[moduleKey];
  if (appAccess === true) return true;
  if (Array.isArray(appAccess) && appAccess.length > 0) return true;
  return false;
}

// Map of pathname-prefix → required moduleKey. Routes not listed here
// require no module access (login, home, profile, hr root, etc).
const ROUTE_ACCESS: Array<{ prefix: string; moduleKey: string }> = [
  // Operational manager-only views (dashboard = manager outlet overview)
  { prefix: "/dashboard", moduleKey: "ops:audit" },
  { prefix: "/audit", moduleKey: "ops:audit" },
  { prefix: "/sops", moduleKey: "ops:sops" },
  { prefix: "/categories", moduleKey: "ops:categories" },
  { prefix: "/schedules", moduleKey: "ops:checklists" },
  // Staff-accessible operations
  { prefix: "/checklists", moduleKey: "ops:checklists" },
  { prefix: "/stock-count", moduleKey: "inventory:stock-count" },
  { prefix: "/receiving", moduleKey: "inventory:receivings" },
  { prefix: "/wastage", moduleKey: "inventory:wastage" },
  { prefix: "/transfers", moduleKey: "inventory:transfers" },
  { prefix: "/claims", moduleKey: "inventory:pay-and-claim" },
  { prefix: "/inventory", moduleKey: "inventory" },
];

export function moduleKeyForPath(pathname: string): string | null {
  // Longest prefix wins so /inventory doesn't shadow /inventory/wastage.
  const match = ROUTE_ACCESS
    .filter((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return match?.moduleKey ?? null;
}
