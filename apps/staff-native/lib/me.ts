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
    const next: StaffSession = {
      ...current,
      name: me.name ?? current.name,
      role: me.role ?? current.role,
      outletId: me.outletId ?? current.outletId,
      outletName: me.outletName ?? current.outletName,
      moduleAccess: me.moduleAccess ?? {},
    };
    await saveSession(next);
    useStaff.getState().setSession(next);
    return next;
  } catch {
    return current;
  }
}
