import Constants from "expo-constants";

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
  return {
    "Content-Type": "application/json",
    Origin: API_BASE,
    Referer: API_BASE + "/",
    "X-App-Version": Constants.expoConfig?.version ?? "1.0.0",
    "X-App-Platform": "android-pos",
    ...(extra ?? {}),
  };
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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
  const res = await fetch(`${API_BASE}${path}`, { headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path} — ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export { API_BASE };
