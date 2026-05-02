// GET /api/finance/accounts
// Lists active accounts in the COA. Used by the inbox "correct" dropdown
// and by future report drill-downs.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const types = url.searchParams.get("types")?.split(",").filter(Boolean);

  const client = getFinanceClient();
  let q = client
    .from("fin_accounts")
    .select("code, name, type, subtype, parent_code, outlet_specific, is_active")
    .eq("is_active", true)
    .order("code");
  if (types && types.length) q = q.in("type", types);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}
