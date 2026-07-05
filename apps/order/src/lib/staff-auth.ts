/**
 * Staff session helpers — localStorage based, Sunmi device persistent.
 * Session expires after 30 days; staff can always logout manually.
 */

export interface StaffSession {
  storeId:    string;
  storeName:  string;
  staffName:  string | null;
  staffId:    string | null;
  /** KDS/staff JWT from /api/staff/auth, sent as `Authorization: Bearer` on the
   *  staff-only routes (order status transitions + /api/staff/* feeds). Optional
   *  so sessions saved before this field existed still parse. */
  token?:     string | null;
  loggedInAt: number;
  expiresAt:  number;
}

const KEY = "staff-session";
const TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getSession(): StaffSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as StaffSession;
    if (Date.now() > session.expiresAt) {
      localStorage.removeItem(KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function saveSession(
  storeId:   string,
  storeName: string,
  staffName: string | null = null,
  staffId:   string | null = null,
  token:     string | null = null,
) {
  const session: StaffSession = {
    storeId,
    storeName,
    staffName,
    staffId,
    token,
    loggedInAt: Date.now(),
    expiresAt:  Date.now() + TTL,
  };
  localStorage.setItem(KEY, JSON.stringify(session));
  localStorage.setItem("kds-store", storeId);
}

export function clearSession() {
  localStorage.removeItem(KEY);
}

/** Authorization headers for staff-only API calls — the Bearer token minted at
 *  login. Returns {} when there's no session/token (pre-token sessions), so the
 *  call still goes out and the server's grace period handles it. */
export function staffAuthHeaders(): Record<string, string> {
  const token = getSession()?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
