// Secret scrubbing for Sentry events — the "Sentry secret-scrubbing
// filter" item from docs/rls-strategy.md. If a Supabase service-role
// key, session JWT, or Stripe key ever lands in an error message,
// request header, or breadcrumb, it must not reach Sentry's servers.
//
// Dependency-free on purpose (no @sentry/* import): the hooks accept
// whatever event shape the SDK passes and scrub it via a JSON
// round-trip, so one implementation serves every app.

// Supabase keys (anon + service-role) and all @celsius/auth session /
// service tokens are JWTs — three base64url segments starting "eyJ".
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g;
const STRIPE_KEY_RE = /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g;

/** Replace anything secret-shaped inside a string. */
export function scrubSecrets(text: string): string {
  return text
    .replace(JWT_RE, "[REDACTED_JWT]")
    .replace(STRIPE_KEY_RE, "[REDACTED_STRIPE_KEY]");
}

/** Scrub every string field of a Sentry event/breadcrumb (deep, via
 *  JSON round-trip — Sentry payloads are JSON-serializable). Returns
 *  the event unmodified if serialization fails: better an unscrubbed
 *  event than a dropped one, EXCEPT secrets — which is why the regexes
 *  above are conservative enough to never throw. */
export function scrubSentryEvent<T>(event: T): T {
  try {
    return JSON.parse(scrubSecrets(JSON.stringify(event))) as T;
  } catch {
    return event;
  }
}
