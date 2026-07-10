import { api } from "./api";
import { loadSession, saveSession, type StaffSession } from "./session";
import { useStaff } from "./store";

type MeResponse = {
  id: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName?: string | null;
  moduleAccess: Record<string, unknown>;
};

// Refreshes the cached session's moduleAccess + role from /api/auth/me.
// Called from the staff tab layout when the cached session is missing
// moduleAccess (sessions saved before Phase 5b). Safe to call repeatedly.
export async function refreshSession(): Promise<StaffSession | null> {
  const current = await loadSession();
  if (!current) return null;
  try {
    const me = await api<MeResponse>("/api/auth/me");
    // Merge rule (mirrors app/_layout.tsx): a null outletId/outletName from
    // /api/auth/me is MEANINGFUL, it says the outlet assignment was removed.
    // Only fall back to the cached value when the field is absent entirely,
    // never nullish-coalesce, or a revoked outlet silently survives refresh.
    const next: StaffSession = {
      ...current,
      name: me.name ?? current.name,
      role: me.role ?? current.role,
      ...(me.outletId !== undefined ? { outletId: me.outletId } : {}),
      ...(me.outletName !== undefined ? { outletName: me.outletName } : {}),
      moduleAccess: me.moduleAccess ?? {},
    };
    await saveSession(next);
    useStaff.getState().setSession(next);
    return next;
  } catch {
    return current;
  }
}
