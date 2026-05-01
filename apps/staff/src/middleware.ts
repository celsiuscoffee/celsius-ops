import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, applySecurityHeaders } from "@celsius/shared";

const COOKIE_NAME = "celsius-session";

const ALLOWED_ORIGINS = [
  "staff.celsiuscoffee.com",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF protection — runs FIRST so state-changing API requests are
  // checked. GET/HEAD/OPTIONS and /api/webhooks/, /api/cron/ paths
  // are auto-exempt (they have their own auth).
  const csrfFail = checkCsrf(request, { allowedOrigins: ALLOWED_ORIGINS });
  if (csrfFail) {
    return NextResponse.json(
      { error: `CSRF check failed: ${csrfFail.reason}` },
      { status: 403 },
    );
  }

  // Skip static assets, auth, and internal routes
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/fonts/")
  ) {
    return NextResponse.next();
  }

  // Just check cookie exists — don't verify JWT in middleware (too slow for every nav)
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Add security headers + cache control
  const response = NextResponse.next();
  applySecurityHeaders(response, { isApi: pathname.startsWith("/api/") });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-touch-icon.png|images/|fonts/|sw.js|manifest.json).*)"],
};
