import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET!,
);

const PUBLIC_PATHS = [
  "/login",
  "/staff",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/pin",
  "/api/auth/verify",
  "/api/auth/logout",
  "/api/settings/system",
];

function addSecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Redirect /admin to backoffice ──────────────────
  // All admin management is consolidated at backoffice.celsiuscoffee.com
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return NextResponse.redirect("https://backoffice.celsiuscoffee.com");
  }

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/fonts") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico") ||
    pathname === "/manifest.json"
  ) {
    return addSecurityHeaders(NextResponse.next());
  }

  const token = request.cookies.get("celsius-session")?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return addSecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
    return addSecurityHeaders(NextResponse.redirect(new URL("/staff", request.url)));
  }

  try {
    const { payload } = await jwtVerify(token, SECRET);
    const { id, name, role, outletId } = payload as {
      id: string;
      name: string;
      role: string;
      outletId: string | null;
    };

    // Inject user info into request headers
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", id);
    requestHeaders.set("x-user-name", name ?? "");
    requestHeaders.set("x-user-role", role ?? "STAFF");
    requestHeaders.set("x-user-outlet", outletId ?? "");

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    return addSecurityHeaders(response);
  } catch {
    // Invalid/expired token
    if (pathname.startsWith("/api/")) {
      return addSecurityHeaders(
        NextResponse.json({ error: "Invalid session" }, { status: 401 }),
      );
    }
    const loginUrl = new URL("/staff", request.url);
    loginUrl.searchParams.set("from", pathname);
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
