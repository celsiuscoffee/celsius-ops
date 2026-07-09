import { api } from "./api";
import { clearSession, saveSession, type StaffSession } from "./session";
import { useStaff } from "./store";
import { deregisterPush } from "./push";
import { queryClient } from "./queryClient";

type PinLoginResponse = {
  token: string;
  user: {
    id: string;
    name: string;
    role: string;
    outletId: string | null;
    outletName: string | null;
    moduleAccess?: Record<string, unknown>;
  };
};

export async function loginWithPin(pin: string, outletId: string | null) {
  const res = await api<PinLoginResponse>("/api/auth/pin-native", {
    method: "POST",
    body: JSON.stringify({ pin, outletId }),
    auth: false,
  });

  const session: StaffSession = {
    userId: res.user.id,
    staffNo: res.user.id,
    name: res.user.name,
    role: res.user.role,
    outletId: res.user.outletId,
    outletName: res.user.outletName,
    token: res.token,
    // Capture moduleAccess at login so tile-gating works on first
    // app launch (before /api/auth/me refresh kicks in).
    moduleAccess: res.user.moduleAccess,
  };
  await saveSession(session);
  // Drop any cached queries from a PREVIOUS user before this session's screens
  // mount, otherwise react-query serves the last user's data (payslips, memos,
  // sales, etc.) until each query's staleTime expires. This is why logging in
  // still showed the previous account for a while.
  queryClient.clear();
  useStaff.getState().setSession(session);
  return session;
}

export async function logout() {
  await deregisterPush().catch(() => {});
  await clearSession();
  // Wipe the previous user's cached queries so the next account starts clean.
  queryClient.clear();
  useStaff.getState().setSession(null);
}
