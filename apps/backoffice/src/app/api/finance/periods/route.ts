// GET /api/finance/periods
// Lists fin_periods (last 24 months) for the close UI.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());

  const client = getFinanceClient();
  const { data, error } = await client
    .from("fin_periods")
    .select("company_id, period, status, closed_at, closed_by, reopened_at, reopen_reason, pnl_snapshot, bs_snapshot, updated_at")
    .eq("company_id", companyId)
    .order("period", { ascending: false })
    .limit(24);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ periods: data ?? [] });
}
