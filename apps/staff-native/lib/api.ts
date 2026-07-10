import { API_BASE_URL } from "./env";
import { clearSession, loadSession } from "./session";
import { useStaff } from "./store";
import { deregisterPush } from "./push";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Outlet Wi-Fi reality: captive portals and dying hotspots accept the TCP
// connection then stall forever. RN's fetch has no default timeout (iOS ~60s+,
// Android ~10s), which pinned busy-spinners on clock-in and uploads. Abort
// after a bounded wait and surface a retryable error instead.
const REQUEST_TIMEOUT_MS = 15_000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer),
  );
}

type ApiOptions = RequestInit & { auth?: boolean };

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { auth = true, headers, ...rest } = opts;
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(headers as Record<string, string> | undefined),
  };

  if (auth) {
    const session = await loadSession();
    if (session?.token) {
      finalHeaders["Authorization"] = `Bearer ${session.token}`;
    }
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: finalHeaders,
    });
  } catch (e) {
    // Abort (timeout) and network failures land here. Normalize to an ApiError
    // so every screen's existing error branch shows a human message instead of
    // a raw "Aborted" TypeError.
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new ApiError(
      0,
      aborted
        ? "No connection. Check your internet and try again."
        : "Network error. Check your internet and try again.",
      null,
    );
  }

  if (res.status === 401 && auth) {
    // Token expired or revoked, wipe BOTH the disk session AND the
    // in-memory Zustand store. Previously only AsyncStorage was
    // cleared, leaving the store with a dead session: UI kept
    // rendering stale data, every subsequent fetch silently failed
    // (no token on disk), and the user only got out of the loop by
    // force-quitting (which reloaded null from disk and bounced to
    // login). Now the layout's session selector flips to null on the
    // first 401 and the (staff) layout redirects to login.
    //
    // Also release this device's push token: without this, a device whose
    // session died kept receiving the previous user's HR pushes on the lock
    // screen until someone else logged in. Best-effort, never blocks the wipe.
    deregisterPush().catch(() => {});
    await clearSession();
    useStaff.getState().setSession(null);
  }

  const text = await res.text();
  const body = text ? safeJson(text) : null;

  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : null) ?? `Request failed: ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }

  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
