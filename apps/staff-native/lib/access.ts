// Mirror of apps/staff/src/lib/access.ts, gates UI to what the
// signed-in user has access to. Server endpoints still validate
// independently, so this is UX only.
//
// Strict on undefined moduleAccess (matches web). The layout refreshes
// from /api/auth/me on mount if the field is missing from the cached
// session, so stale sessions get repaired without a forced sign-out.

export function hasAccess(
  role: string | undefined,
  moduleAccess: Record<string, unknown> | undefined,
  moduleKey: string | undefined,
): boolean {
  if (!moduleKey) return true;
  if (role === "OWNER" || role === "ADMIN") return true;
  if (moduleAccess == null) return false;

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
