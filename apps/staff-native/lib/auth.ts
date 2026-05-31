import { api } from "./api";
import { clearSession, saveSession, type StaffSession } from "./session";
import { useStaff } from "./store";
import { deregisterPush } from "./push";

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
  useStaff.getState().setSession(session);
  return session;
}

export async function logout() {
  await deregisterPush().catch(() => {});
  await clearSession();
  useStaff.getState().setSession(null);
}
