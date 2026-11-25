import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, applySecurityHeaders } from "@celsius/shared";
import { jwtVerify } from "jose";

const COOKIE_NAME = "celsius-session";

/**
 * A cookie is not a session. This check used to be `if (!token) redirect`, so a
 * cookie holding an EXPIRED (or rotated-secret) token still rendered the whole
 * signed-in shell while every request behind it 401'd — the staff PWA stays
 * mounted all shift, and the first thing a staffer saw was an "Unauthorized"
 * alert on a checklist photo upload. Verify the token so a dead session lands
 * on /login instead.
 *
 * Verified here rather than via @celsius/auth's getSession(): that reads
 * next/headers, which middleware's edge runtime doesn't serve. jose is
 * edge-safe and already a dependency.
 *
 * Fails OPEN when JWT_SECRET is absent (the pre-verification behaviour) — a
 * misconfigured env must not lock every staffer out of the app; the route
 * handlers still authenticate on their own.
 */
async function isSessionTokenValid(token: string): Promise<boolean> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return true;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

/**
 * True when this session is carrying a PIN somebody else chose (HR issued it,
 * or a manager reset it) that the holder has not replaced yet.
 *
 * Fails CLOSED-ish by returning false on an unreadable token: an unverifiable
 * token is already handled as "not signed in" below, and treating it as
 * must-change would redirect people into a screen they cannot authenticate to.
 */
async function mustChangePin(token: string): Promise<boolean> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return payload.mustChangePin === true;
  } catch {
    return false;
  }
}

/**
 * The only things reachable while a temp PIN is outstanding. Everything else —
 * every page, and every /api/* route the native app calls — is refused until
 * the PIN is replaced.
 *
 * A client-side redirect would not be enough: apps/staff-native talks to these
 * same endpoints, and a build that predates the change-PIN screen, or a stale
 * cached web bundle, would sail straight past a flag it never reads. The gate
 * has to be here, where neither can skip it.
 */
const TEMP_PIN_ALLOWED = [
  "/change-pin",            // the page they are sent to
  "/api/auth/change-pin",   // the call that clears the flag
  "/api/auth/logout",
  "/api/auth/me",
  "/login",
  "/privacy",
];

/**
 * Static and framework paths, never gated by anything. The temp-PIN gate and
 * the signed-in redirect below share this list on purpose: if the gate caught
 * /_next/* the change-PIN page would load with no JavaScript, stranding the
 * very person it exists to unblock.
 */
function isPublicAsset(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/privacy" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/fonts/")
  );
}

const ALLOWED_ORIGINS = [
  "staff.celsiuscoffee.com",
];

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // CSRF protection — runs FIRST. /api/auth/pin-native is the bootstrap
  // login call from apps/staff-native; it can't carry a bearer token yet
  // (the response IS the token), and the route has its own rate limit
  // + PIN check, so cross-origin abuse is bounded.
  const csrfFail = checkCsrf(request, {
    allowedOrigins: ALLOWED_ORIGINS,
    exemptPrefixes: ["/api/auth/pin-native"],
  });
  if (csrfFail) {
    return NextResponse.json(
      { error: `CSRF check failed: ${csrfFail.reason}` },
      { status: 403 },
    );
  }

  // Apply headers regardless of short-circuit path so /api/* responses
  // also get CSP + Cache-Control: no-store (was being skipped before).
  const buildResponse = (inner: () => NextResponse): NextResponse => {
    const r = inner();
    applySecurityHeaders(r, { isApi });
    return r;
  };

  // Temp-PIN gate. Deliberately BEFORE the /api/ bypass below: that bypass
  // exists so route handlers can do their own auth, but a staffer holding a
  // handover PIN must not reach any handler at all.
  const sessionToken = request.cookies.get(COOKIE_NAME)?.value;
  const bearer = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1];
  const anyToken = sessionToken ?? bearer;
  const gateable =
    !isPublicAsset(pathname) &&
    !TEMP_PIN_ALLOWED.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (anyToken && gateable) {
    if (await mustChangePin(anyToken)) {
      if (isApi) {
        return buildResponse(() =>
          NextResponse.json(
            {
              error: "Set your own PIN before continuing.",
              code: "must_change_pin",
            },
            { status: 403 },
          ),
        );
      }
      return NextResponse.redirect(new URL("/change-pin", request.url));
    }
  }

  if (isPublicAsset(pathname) || pathname.startsWith("/api/")) {
    return buildResponse(() => NextResponse.next());
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !(await isSessionTokenValid(token))) {
    const login = new URL("/login", request.url);
    // Come back to the page they were on once they have signed in again.
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    if (token) login.searchParams.set("reason", "expired");
    return NextResponse.redirect(login);
  }

  return buildResponse(() => NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-touch-icon.png|images/|fonts/|sw.js|manifest.json).*)"],
};
