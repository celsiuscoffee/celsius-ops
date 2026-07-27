import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, applySecurityHeaders } from "@celsius/shared";

// Browsers + the Capacitor wrapper (pickup native app) that legitimately
// post to this app. Capacitor on Android sends Origin: capacitor://localhost;
// iOS sends ionic://localhost. We previously also allowed https://localhost
// but that's broader than necessary — any browser tab visiting a local
// server could pass the check. Drop it; we'll re-add only if a real device
// actually fails after this lands.
const ALLOWED_ORIGINS = [
  "order.celsiuscoffee.com",
  "celsiuscoffee.com",
  "www.celsiuscoffee.com",
  "capacitor://localhost",
  "ionic://localhost",
];

// Privileged-API guard. Was a Supabase auth check, which validated
// any signed-up Supabase user — anyone who created an account on
// the order app could blast pushes to every PWA subscriber. Now
// requires a constant-time match against ADMIN_API_KEY, an env-only
// secret server-set in Vercel and held by trusted backoffice code
// (or curl by an operator). No client should ever receive it.
async function isValidAdminToken(token: string): Promise<boolean> {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || expected.length < 16) return false; // fail-closed if unset
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Every customer route is a Next.js page now. The old Expo-Web SPA shell
  // (apps/pickup-native's web export, copied into /public by build-pwa.mjs and
  // rewritten to for any un-ported route) is GONE — it was the retired pickup
  // ordering flow leaking onto the web, complete with its own outlet picker
  // and manual table entry that bypassed the QR-table-only rules. Unknown
  // paths now fall through to Next routing and 404 like any normal app;
  // stale Expo-only routes (/rm-return, /stripe-redirect) have no live web
  // callers (native payment returns use the celsiuscoffee:// scheme).

  // CSRF protection — applies to ALL state-changing /api/* requests
  // except webhooks/cron (auto-exempt). Runs before the per-route
  // admin-token check below so a cross-origin forgery can't even
  // reach the auth path.
  const csrfFail = checkCsrf(request, { allowedOrigins: ALLOWED_ORIGINS });
  if (csrfFail) {
    return NextResponse.json(
      { error: `CSRF check failed: ${csrfFail.reason}` },
      { status: 403 },
    );
  }

  // Apply headers on every return path. Previously the privileged-API
  // guard short-circuited via plain NextResponse.next() and shipped
  // no CSP / no-store on the bulk of /api/* responses.
  const buildResponse = (inner: () => NextResponse): NextResponse => {
    const r = inner();
    applySecurityHeaders(r, { isApi });
    return r;
  };

  // ── API auth guard for the two privileged endpoints ──
  const isProtectedApi =
    pathname === "/api/push/blast" ||
    pathname === "/api/push/subscriber-count";

  if (!isProtectedApi) return buildResponse(() => NextResponse.next());

  // Skip preflight requests
  if (request.method === "OPTIONS") return buildResponse(() => NextResponse.next());

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const valid = await isValidAdminToken(token);
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return buildResponse(() => NextResponse.next());
}

// Matcher must include every path the PWA rewrite or the /api/* CSRF
// guard cares about. Excludes Next internals and the Expo bundle path
// so static assets are served untouched.
export const config = {
  matcher: ["/((?!_next/|_expo/).*)"],
};
