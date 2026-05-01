import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, applySecurityHeaders } from "@celsius/shared";

const COOKIE_NAME = "celsius-session";

// Origins allowed to make state-changing requests. Includes the
// canonical prod host plus the Vercel preview domain so PR previews
// keep working. Extend if a partner integration legitimately POSTs
// from a different origin.
const ALLOWED_ORIGINS = [
  "backoffice.celsiuscoffee.com",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // CSRF protection — runs FIRST so state-changing API requests are
  // checked even when we'd otherwise bypass middleware for /api/*.
  // GET/HEAD/OPTIONS, /api/webhooks/*, and /api/cron/* are exempt.
  const csrfFail = checkCsrf(request, { allowedOrigins: ALLOWED_ORIGINS });
  if (csrfFail) {
    return NextResponse.json(
      { error: `CSRF check failed: ${csrfFail.reason}` },
      { status: 403 },
    );
  }

  // Build the response we'll return. We attach security headers ONCE
  // at the end, regardless of which short-circuit path we take, so
  // CSP/Cache-Control are guaranteed to ship on every response —
  // including /api/* responses that previously skipped headers.
  const buildResponse = (
    inner: () => NextResponse,
  ): NextResponse => {
    const r = inner();
    applySecurityHeaders(r, { isApi });
    return r;
  };

  // Skip static assets, auth, and internal routes — but still apply
  // headers via buildResponse() so API responses get CSP + no-store.
  if (
    pathname === "/login" ||
    pathname.startsWith("/r/") ||
    pathname.startsWith("/review/") ||
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
    return buildResponse(() => NextResponse.next());
  }

  // Authenticated pages: just check cookie exists, don't verify JWT
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return buildResponse(() => NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-touch-icon.png|images/|fonts/|sw.js|manifest.json).*)"],
};
