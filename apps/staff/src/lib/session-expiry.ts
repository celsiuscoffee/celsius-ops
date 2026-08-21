"use client";

/**
 * Expired-session handling for the staff web app.
 *
 * The session cookie is a 12-hour JWT with no renewal (`SESSION_MAX_AGE` in
 * packages/auth). The staff app is a PWA that outlet staff leave open for a
 * whole shift, so when the token dies the mounted page keeps rendering its
 * last-fetched data while every request behind it 401s. Nothing told the
 * staffer: production logs show devices sitting for hours 401ing
 * /api/auth/me + /api/checklists + /api/hr/clock on a loop.
 *
 * The first VISIBLE sign was a dead-end alert at the point of work — the
 * reported "staff.celsiuscoffee.com says: Unauthorized" when attaching photo
 * proof to a checklist step, with the photo lost and no route forward but a
 * manual reload.
 *
 * One fetch interceptor turns any 401 from our own API into what it actually
 * means: sign in again, then come back to what you were doing.
 * apps/staff-native does the same in its lib/api.ts.
 */

/** Where an expired session sends the staffer back to when `next` is unusable. */
export const DEFAULT_AFTER_LOGIN = "/checklists";

/**
 * A 401 from these means "wrong PIN / wrong password", NOT "your session
 * expired". /api/auth/change-pin is the one that bites from inside the app:
 * it 401s on a mistyped CURRENT pin, and a staffer fat-fingering their pin
 * change must not be thrown out to the login screen.
 */
const AUTH_BOOTSTRAP_PATHS = [
  "/api/auth/pin",
  "/api/auth/pin-native",
  "/api/auth/login",
  "/api/auth/change-pin",
];

/** Resolve whatever fetch() was handed into a pathname on THIS origin, or null. */
export function requestPath(input: RequestInfo | URL, origin: string): string | null {
  const raw =
    typeof input === "string" ? input
    : input instanceof URL ? input.href
    : typeof (input as Request).url === "string" ? (input as Request).url
    : null;
  if (raw === null) return null;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return null; // Supabase, Sentry, … not ours to judge
    return url.pathname;
  } catch {
    return null;
  }
}

/**
 * Is this response the app telling us the session is gone? Only our own
 * /api/* routes count, and never the login endpoints themselves.
 */
export function isExpiredSessionResponse(path: string | null, status: number): boolean {
  if (status !== 401 || path === null) return false;
  if (!path.startsWith("/api/")) return false;
  return !AUTH_BOOTSTRAP_PATHS.includes(path);
}

/** Build the /login URL that returns the staffer to where they were. */
export function loginRedirectUrl(currentPath: string): string {
  const params = new URLSearchParams({ reason: "expired" });
  const next = safeNextPath(currentPath);
  if (next !== DEFAULT_AFTER_LOGIN) params.set("next", next);
  return `/login?${params.toString()}`;
}

/**
 * Only ever redirect to a path inside this app. Rejects absolute URLs,
 * protocol-relative "//evil.com", and /login itself (which would loop).
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_AFTER_LOGIN;
  if (!raw.startsWith("/") || raw.startsWith("//")) return DEFAULT_AFTER_LOGIN;
  const path = raw.split("?")[0].split("#")[0];
  if (path === "/login" || path === "/") return DEFAULT_AFTER_LOGIN;
  return raw;
}

// Module-level: many requests can 401 in the same tick (the page mounts and
// fires /api/auth/me + the page's own reads together). Redirect once.
let redirecting = false;

/** True once a 401 has started the bounce to /login — callers skip their own error UI. */
export function sessionExpiryHandled(): boolean {
  return redirecting;
}

export function handleExpiredSession(): void {
  if (redirecting) return;
  redirecting = true;
  const here = window.location.pathname + window.location.search;
  // replace(), not assign(): the dead page must not sit in the back stack.
  window.location.replace(loginRedirectUrl(here));
}

const INSTALLED = "__celsiusSessionExpiryInstalled";

/**
 * Patch window.fetch once so every call site in the app — 90-odd of them,
 * SWR reads and one-off mutations alike — inherits the behaviour without
 * being rewritten. The response is passed through untouched (body unread).
 */
export function installSessionExpiryInterceptor(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    if (isExpiredSessionResponse(requestPath(input, window.location.origin), res.status)) {
      handleExpiredSession();
    }
    return res;
  };
}

// At most one liveness check per minute — /api/auth/me is Cache-Control
// private, max-age=60 anyway.
const LIVENESS_INTERVAL_MS = 60_000;
let lastChecked = 0;

/**
 * Check the session when the app comes back to the foreground. Staff put the
 * phone down mid-shift; without this the expiry is only discovered by the next
 * thing they try to save. The 401 is caught by the interceptor above.
 */
export function installForegroundSessionCheck(): () => void {
  const check = () => {
    if (document.visibilityState !== "visible" || redirecting) return;
    const now = Date.now();
    if (now - lastChecked < LIVENESS_INTERVAL_MS) return;
    lastChecked = now;
    fetch("/api/auth/me").catch(() => {}); // offline is not expiry
  };
  document.addEventListener("visibilitychange", check);
  return () => document.removeEventListener("visibilitychange", check);
}

/** Test seam — resets the once-only redirect latch. */
export function __resetSessionExpiryForTests(): void {
  redirecting = false;
  lastChecked = 0;
}
