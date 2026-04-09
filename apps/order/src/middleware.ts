import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

  // ── API auth guard ─────────────────────────────────────────────────────────
  const isProtectedApi =
    pathname === "/api/push/blast" ||
    pathname === "/api/push/subscriber-count";

  if (!isProtectedApi) return NextResponse.next();

  // Skip preflight requests
  if (request.method === "OPTIONS") return NextResponse.next();

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const valid = await isValidAdminToken(token);
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export const config = {
  matcher: ["/api/push/blast", "/api/push/subscriber-count"],
};
