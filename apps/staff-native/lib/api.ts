import { API_BASE_URL } from "./env";
import { clearSession, loadSession } from "./session";
import { useStaff } from "./store";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
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

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
  });

  if (res.status === 401 && auth) {
    // Token expired or revoked, wipe BOTH the disk session AND the
    // in-memory Zustand store. Previously only AsyncStorage was
    // cleared, leaving the store with a dead session: UI kept
    // rendering stale data, every subsequent fetch silently failed
    // (no token on disk), and the user only got out of the loop by
    // force-quitting (which reloaded null from disk and bounced to
    // login). Now the layout's session selector flips to null on the
    // first 401 and the user is routed to login immediately.
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
