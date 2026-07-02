import Constants from "expo-constants";
import { markOnline, markOffline } from "./connectivity";
import { usePos } from "./store";

/**
 * Thin client for the POS Next.js API (auth/pin, loyalty, order
 * create, payment terminal). Same routes the web register calls —
 * we're just hitting them from a native shell instead of a WebView.
 *
 * The CSRF middleware on the POS API requires an Origin/Referer that
 * matches the deployment, so we always send them.
 */
const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "https://backoffice.celsiuscoffee.com";

function headers(extra?: Record<string, string>): Record<string, string> {
  // Replay the POS session JWT (captured at PIN login) as a Bearer. The web
  // register authenticates via its httpOnly cookie; the native till can't read
  // that cookie, so it carries the token in the store and sends it here. Absent
  // before sign-in (e.g. the /api/pos/auth/pin call itself), which is fine.
  const token = usePos.getState().staff?.token;
  return {
    "Content-Type": "application/json",
    Origin: API_BASE,
    Referer: API_BASE + "/",
    "X-App-Version": Constants.expoConfig?.version ?? "1.0.0",
    "X-App-Platform": "android-pos",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

const TIMEOUT_MS = 8000;

/** One fetch with a hard timeout + connectivity tracking. A response (even an
 *  error status) means the server is REACHABLE → markOnline. A thrown
 *  fetch/abort means the network is down → markOffline. This is what drives the
 *  offline banner + the redeem/lookup gating, and stops loyalty calls hanging
 *  ~30s on a dead socket during an outage. */
async function doFetch(path: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
    markOnline();
    return res;
  } catch (e) {
    markOffline();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await doFetch(path, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path} — ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await doFetch(path, { headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path} — ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export { API_BASE };
