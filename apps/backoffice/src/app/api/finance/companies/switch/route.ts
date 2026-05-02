// POST /api/finance/companies/switch
// Body: { companyId }
// Sets the active company cookie. Cookie is HttpOnly + scoped to /finance.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { COMPANY_COOKIE } from "@/lib/finance/companies";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { companyId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!body.companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  // Validate the company exists and is active.
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_companies")
    .select("id")
    .eq("id", body.companyId)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Unknown company" }, { status: 404 });

  const res = NextResponse.json({ ok: true, companyId: body.companyId });
  res.cookies.set(COMPANY_COOKIE, body.companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
