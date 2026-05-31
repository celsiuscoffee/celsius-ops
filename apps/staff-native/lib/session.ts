import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "celsius_staff_session_v1";

export type StaffSession = {
  userId: string;
  staffNo: string;
  name: string;
  role: string;
  outletId: string | null;
  outletName: string | null;
  token: string;
  // Per-module access rights. Mirrors the JSONB column on User. Used by
  // hasAccess() to gate tiles. Refreshed from /api/auth/me on every
  // app launch so role/outlet changes propagate without a sign-out.
  moduleAccess?: Record<string, unknown>;
};

export async function loadSession(): Promise<StaffSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: StaffSession): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_KEY);
}
