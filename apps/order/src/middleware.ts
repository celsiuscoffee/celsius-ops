import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkCsrf, applySecurityHeaders } from "@celsius/shared";

// Browsers + the Capacitor wrapper (pickup native app) that legitimately
// post to this app. Capacitor sends Origin: capacitor://localhost and
// the iOS Capacitor variant can also send https://localhost. Add other
// integrations here as they come on (DNS-restricted partners only).
const ALLOWED_ORIGINS = [
  "order.celsiuscoffee.com",
  "celsiuscoffee.com",
  "www.celsiuscoffee.com",
  "capacitor://localhost",
  "https://localhost",
  "ionic://localhost",
];

async function isValidAdminToken(token: string): Promise<boolean> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    return !error && !!user;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

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

// Matcher must include all /api/* routes so the CSRF check runs on
// state-changing requests (not just the two protected push endpoints
// the previous matcher allowed).
export const config = {
  matcher: ["/api/:path*"],
};
