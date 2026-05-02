// Shared security/cache headers applied via middleware on every app.
//
// CSP (Content-Security-Policy) — defense in depth against XSS. We
// can't lock it down too tight because Next.js hydration uses inline
// scripts, Cloudinary/Supabase serve images, and Sentry/Vercel
// load runtime scripts. The policy below is a balanced starter:
//   - script-src: self + nonce-able. We allow 'unsafe-inline' for
//     now because Next.js inlines theme-flash scripts; tighten via
//     script-nonce in a future pass.
//   - style-src: self + 'unsafe-inline' (Tailwind / styled-jsx).
//   - img-src: self + data: + Cloudinary + Supabase Storage.
//   - connect-src: self + Supabase (any subdomain) + Sentry + Upstash.
//   - frame-ancestors: 'none' (already enforced by X-Frame-Options).
//
// Cache-Control — browsers default to caching API responses
// aggressively if no header is set. Force `no-store, max-age=0` on
// any API path so a stale response can't be served to a different
// authenticated session via a shared proxy/CDN. Pages get the
// existing Vercel default.

export type SecurityHeadersOptions = {
  /** Extra hosts to allow in connect-src (e.g. specific CDN). */
  extraConnectSrc?: string[];
  /** Extra hosts to allow in img-src. */
  extraImgSrc?: string[];
  /** When true, the response is from /api/* — apply Cache-Control: no-store. */
  isApi?: boolean;
};

const BASE_CONNECT_SRC = [
  "'self'",
  "https://*.supabase.co",
  "https://*.supabase.in",
  "https://*.upstash.io",
  "https://*.sentry.io",
  "https://api.cloudinary.com",
  "https://res.cloudinary.com",
  // Stripe — JS SDK posts to api.stripe.com; analytics calls
  // *.stripe.com. Without these, every Stripe Elements call XHR-fails.
  "https://api.stripe.com",
  "https://*.stripe.com",
  // Vercel Speed Insights / Analytics beacon
  "https://vitals.vercel-insights.com",
];

const BASE_IMG_SRC = [
  "'self'",
  "data:",
  "blob:",
  "https://*.supabase.co",
  "https://res.cloudinary.com",
  "https://lh3.googleusercontent.com",
  "https://*.stripe.com",
];

// Hosts loaded as <script src="..."> from across the apps. Stripe.js
// and Vercel's analytics scripts have to be allowlisted explicitly
// once we move beyond 'self' + 'unsafe-inline'.
const BASE_SCRIPT_SRC_HOSTS = [
  "https://va.vercel-scripts.com",
  "https://js.stripe.com",
];

// Hosts loaded into <iframe>. Stripe Elements renders card fields in
// an iframe served from js.stripe.com / hooks.stripe.com. PDFs from
// Supabase storage (PO docs, POPs, invoice photos) are rendered via the
// browser's built-in PDF viewer in an iframe — without supabase.co
// here, every "View PDF" link surfaces the browser's CSP block page.
const BASE_FRAME_SRC = [
  "'self'",
  "https://js.stripe.com",
  "https://hooks.stripe.com",
  "https://*.supabase.co",
  "https://*.supabase.in",
  // Cloudinary delivers PDFs via the same iframe pattern (fl_attachment).
  "https://res.cloudinary.com",
];

export function buildCsp(opts: SecurityHeadersOptions = {}): string {
  const connectSrc = [...BASE_CONNECT_SRC, ...(opts.extraConnectSrc ?? [])];
  const imgSrc = [...BASE_IMG_SRC, ...(opts.extraImgSrc ?? [])];

  return [
    "default-src 'self'",
    // 'unsafe-inline' for Next.js theme-flash + styled-jsx hydration.
    // 'unsafe-eval' is needed by some dev-mode hot-reload paths —
    // accept it. Tighten to nonces in a future pass when we wire
    // up Next.js' built-in CSP nonce support.
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${BASE_SCRIPT_SRC_HOSTS.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(" ")}`,
    `connect-src ${connectSrc.join(" ")}`,
    "font-src 'self' data:",
    `frame-src ${BASE_FRAME_SRC.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Apply security + cache headers to a NextResponse-like object.
 * Mutates response.headers in place.
 */
export function applySecurityHeaders(
  response: { headers: Headers },
  opts: SecurityHeadersOptions = {},
): void {
  response.headers.set("Content-Security-Policy", buildCsp(opts));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  if (opts.isApi) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }
}
