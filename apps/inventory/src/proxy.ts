import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/pin"];

// Owner/Admin-only routes
const ADMIN_ONLY = [
  "/admin/outlets",
  "/admin/staff",
  "/admin/rules",
  "/admin/integrations",
  "/api/staff",
];

// Admin + Manager routes (includes master data, procurement, loyalty, reports)
const MANAGER_ROUTES = [
  "/admin",
  "/admin/products",
  "/admin/categories",
  "/admin/suppliers",
  "/admin/menus",
  "/admin/orders",
  "/admin/receivings",
  "/admin/invoices",
  "/admin/par-levels",
  "/admin/reports",
  "/admin/loyalty",
];

// Staff cannot access these app pages (manager+ only)
const MANAGER_APP_ROUTES = ["/order", "/transfer", "/wastage"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/fonts") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico") ||
    pathname === "/manifest.json"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("celsius-session")?.value;

  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const user = await verifyToken(token);
  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Role-based route protection
  const isApi = pathname.startsWith("/api/");
  const deny = (msg: string) => {
    if (isApi) return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.redirect(new URL("/home", request.url));
  };

  // Admin-only pages
  if (ADMIN_ONLY.some((p) => pathname.startsWith(p))) {
    if (user.role !== "OWNER" && user.role !== "ADMIN") return deny("Admin access required");
  }

  // Manager routes (admin + manager)
  if (pathname.startsWith("/admin")) {
    if (MANAGER_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
      if (user.role !== "OWNER" && user.role !== "ADMIN" && user.role !== "MANAGER") {
        return deny("Manager access required");
      }
    }
  }

  // Mobile app routes restricted to manager+
  if (MANAGER_APP_ROUTES.some((p) => pathname.startsWith(p))) {
    if (user.role !== "OWNER" && user.role !== "ADMIN" && user.role !== "MANAGER") {
      return deny("Manager access required");
    }
  }

  // Inject user info into request headers for API routes
  const res = NextResponse.next();
  res.headers.set("x-user-id", user.id);
  res.headers.set("x-user-role", user.role);
  res.headers.set("x-user-outlet", user.outletId || "");
  res.headers.set("x-user-name", user.name);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
