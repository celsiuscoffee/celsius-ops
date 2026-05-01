// CSRF protection via Origin / Referer header check.
//
// Why this works:
// State-changing requests (POST/PUT/PATCH/DELETE) carry an Origin
// header that browsers set automatically and JavaScript cannot
// override. Comparing Origin against the host the request hit
// rejects cross-site form-POST and fetch-without-credentials
// attacks. This is the OWASP-recommended baseline for
// SameSite=lax cookies (which we already use), and it costs nothing.
//
// Limitations:
// - Doesn't help if an attacker can set a *.celsiuscoffee.com subdomain
//   (mitigated by us controlling our DNS).
// - Some legacy clients strip Origin — we fall back to Referer.
// - WEBHOOK endpoints (Stripe, Revenue Monster, GHL) receive
//   cross-origin POSTs by design. They authenticate via HMAC
//   signature instead of CSRF token; the caller must mark them as
//   safe (see CSRF_EXEMPT_PREFIXES).

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Path prefixes that legitimately receive cross-origin POSTs and
// authenticate by other means (HMAC signatures, bearer tokens).
// Anything matching these is exempted from the Origin check —
// they have their own auth path.
const DEFAULT_EXEMPT_PREFIXES = [
  "/api/webhooks/",         // RESTful-style webhooks (future)
  "/api/cron/",             // Vercel crons — Bearer + IP-pinned
  "/api/ingest/",           // partner ingest endpoints — token auth
];

// Patterns for webhook routes that don't follow the /api/webhooks/
// prefix convention. These are server-to-server callbacks from
// payment providers (Stripe, Revenue Monster, GHL), delivery
// platforms (Grab, FoodPanda), and OAuth providers — none send an
// Origin header AND all authenticate via HMAC sig / Bearer token.
//
// Match any /api/.../webhook or /api/.../callback (with optional
// trailing path) to cover the existing routes:
//   /api/payments/stripe/webhook
//   /api/payments/webhook         (Revenue Monster)
//   /api/grab/webhook
//   /api/delivery/webhook
//   /api/auth/<provider>/callback (any OAuth integrations)
const DEFAULT_EXEMPT_PATTERNS: RegExp[] = [
  /^\/api\/.*\/webhook(\/.*)?$/i,
  /^\/api\/.*\/callback(\/.*)?$/i,
];

export type CsrfOptions = {
  /**
   * Allowed origins (without protocol). Provide explicit list so we
   * never trust `request.url`'s host when the app is reverse-proxied.
   * Example: ["backoffice.celsiuscoffee.com", "celsius-backoffice.vercel.app"]
   */
  allowedOrigins?: string[];
  /** Path prefixes to skip (in addition to the defaults). */
  exemptPrefixes?: string[];
};

/**
 * Check whether a request is CSRF-safe. Returns:
 *   - null  → request is safe, proceed
 *   - { reason } → request blocked, caller should return 403
 */
export function checkCsrf(
  request: Request,
  opts: CsrfOptions = {},
): null | { reason: string } {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return null;

  const url = new URL(request.url);
  const exemptPrefixes = [...DEFAULT_EXEMPT_PREFIXES, ...(opts.exemptPrefixes ?? [])];
  if (exemptPrefixes.some((p) => url.pathname.startsWith(p))) return null;
  if (DEFAULT_EXEMPT_PATTERNS.some((re) => re.test(url.pathname))) return null;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = url.host;

  // Build the set of acceptable origin hostnames
  const allowed = new Set<string>([host]);
  for (const o of opts.allowedOrigins ?? []) allowed.add(o);
  // Always allow localhost for dev — the request URL's host will be
  // the dev host already, but explicit is clearer.
  if (process.env.NODE_ENV !== "production") {
    allowed.add("localhost:3000");
    allowed.add("localhost:3001");
    allowed.add("localhost:3002");
    allowed.add("localhost:3003");
    allowed.add("localhost:3004");
    allowed.add("localhost:3005");
    allowed.add("localhost:3006");
  }

  // Vercel preview deploys: VERCEL_ENV=preview during PR builds. The
  // hostname is generated per-PR (celsius-<app>-<hash>-<scope>.vercel.app).
  // Trust the request's own host (already in `allowed`) — preview
  // requests POST to themselves, not cross-origin to prod. The match
  // below also accepts any *.vercel.app suffix for redundancy.
  const isPreview = process.env.VERCEL_ENV === "preview";

  // Prefer Origin header (most browsers set it on POST). Fall back to
  // Referer for older / non-browser clients. If both are missing on a
  // state-changing request, reject — we'd rather block a legitimate
  // edge-case than let through a CSRF.
  let candidate: string | null = null;
  if (origin) {
    try { candidate = new URL(origin).host; } catch { candidate = null; }
  } else if (referer) {
    try { candidate = new URL(referer).host; } catch { candidate = null; }
  }

  if (!candidate) return { reason: "Missing Origin/Referer header" };
  if (allowed.has(candidate)) return null;
  // Wildcard fallback for Vercel preview deploys
  if (isPreview && candidate.endsWith(".vercel.app")) return null;
  return { reason: `Origin "${candidate}" not in allow list` };
}
