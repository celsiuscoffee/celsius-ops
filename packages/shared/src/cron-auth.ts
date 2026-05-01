// Cron authentication helper. Used by every Vercel cron handler to
// verify the request actually came from Vercel's cron scheduler (or
// from a manual invocation with the right bearer token).
//
// CRITICAL: fail-closed semantics. If CRON_SECRET is missing/empty,
// the cron MUST reject all requests — not run unauthenticated. The
// previous pattern `if (env.CRON_SECRET && header !== bearer)` was
// fail-open: a misconfigured environment turned every cron into a
// public endpoint.

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Verify a cron handler request. Returns `{ ok: true }` when the
 * Authorization header matches `Bearer ${CRON_SECRET}`. Otherwise
 * returns a 401/500 reason.
 */
export function checkCronAuth(headers: Headers): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail-closed when env var is missing or empty. Surfaces as a 500
    // so monitoring catches the misconfiguration instead of silently
    // running unauthenticated.
    return { ok: false, status: 500, error: "CRON_SECRET not configured" };
  }
  const auth = headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
