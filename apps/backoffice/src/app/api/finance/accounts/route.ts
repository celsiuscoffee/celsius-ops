// GET /api/finance/accounts — lists accounts in the COA (active only by
// default; ?all=true includes deactivated). Used by report drill-downs, the
// recon category labels and the /finance/coa page.
// POST — create an account. PATCH — rename / activate / deactivate.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "cogs", "expense"] as const;

async function guard(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return { error: auth.error };
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: auth.user };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const url = new URL(req.url);
  const types = url.searchParams.get("types")?.split(",").filter(Boolean);
  const includeInactive = url.searchParams.get("all") === "true";

  const client = getFinanceClient();
  let q = client
    .from("fin_accounts")
    .select("code, name, type, subtype, parent_code, outlet_specific, is_active")
    .order("code");
  if (!includeInactive) q = q.eq("is_active", true);
  if (types && types.length) q = q.in("type", types);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  let body: { code?: string; name?: string; type?: string; parentCode?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const code = body.code?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  const type = body.type?.trim() ?? "";
  if (!/^\d[\d-]{2,9}$/.test(code)) {
    return NextResponse.json({ error: "Code must be digits and dashes, like 6504 or 6000-01" }, { status: 400 });
  }
  if (name.length < 3) return NextResponse.json({ error: "Name too short" }, { status: 400 });
  if (!ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number])) {
    return NextResponse.json({ error: `Type must be one of ${ACCOUNT_TYPES.join(", ")}` }, { status: 400 });
  }

  const client = getFinanceClient();
  const { data: existing } = await client.from("fin_accounts").select("code").eq("code", code).maybeSingle();
  if (existing) return NextResponse.json({ error: `Account ${code} already exists` }, { status: 409 });
  if (body.parentCode) {
    const { data: parent } = await client.from("fin_accounts").select("code").eq("code", body.parentCode).maybeSingle();
    if (!parent) return NextResponse.json({ error: `Parent ${body.parentCode} not found` }, { status: 400 });
  }

  const { error } = await client.from("fin_accounts").insert({
    code, name, type, parent_code: body.parentCode ?? null, is_active: true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, code });
}

export async function PATCH(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  let body: { code?: string; name?: string; isActive?: boolean } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body.code) return NextResponse.json({ error: "code required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim().length >= 3) patch.name = body.name.trim();
  if (typeof body.isActive === "boolean") patch.is_active = body.isActive;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const client = getFinanceClient();
  const { error } = await client.from("fin_accounts").update(patch).eq("code", body.code);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
