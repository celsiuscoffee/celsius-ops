import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { checkCsrf, applySecurityHeaders } from "@celsius/shared";

const PUBLIC_PATHS = ["/login", "/api/auth/pin", "/api/auth/logout", "/api/auth/verify-manager", "/customer-display"];

// POS runs in two contexts: a browser pointed at pos.celsiuscoffee.com
// (manager workstation) and the SUNMI native wrapper which Capacitor
// loads as capacitor://localhost. https://localhost dropped — broader
// than needed; SUNMI uses the capacitor scheme.
const ALLOWED_ORIGINS = [
  "pos.celsiuscoffee.com",
  "capacitor://localhost",
  "ionic://localhost",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CSRF protection — runs first. GET/HEAD/OPTIONS and webhook/cron
  // paths are auto-exempt.
  const csrfFail = checkCsrf(request, { allowedOrigins: ALLOWED_ORIGINS });
  if (csrfFail) {
    return NextResponse.json(
      { error: `CSRF check failed: ${csrfFail.reason}` },
      { status: 403 },
    );
  }

  const response = NextResponse.next();

  // Security headers + cache-control on /api/*
  applySecurityHeaders(response, { isApi: pathname.startsWith("/api/") });
  response.headers.set("X-XSS-Protection", "1; mode=block");

  // Skip public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.png" ||
    pathname === "/manifest.json"
  ) {
    return response;
  }

  // Skip API routes (they use requireAuth internally)
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/")) {
    return response;
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const user = await verifyToken(token);
    if (!user) throw new Error("Invalid token");
  } catch {
    const redirect = NextResponse.redirect(new URL("/login", request.url));
    redirect.cookies.delete(COOKIE_NAME);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|images/).*)"],
};
