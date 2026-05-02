// GET  /api/finance/sst       — list filings (last 24 periods)
// POST /api/finance/sst       — body { yearMonth } → calculate + persist draft

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { calculateSst, persistDraft } from "@/lib/finance/agents/sst";
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
    .from("fin_sst_filings")
    .select("id, company_id, period, output_tax, input_tax, net_payable, filing_status, filed_at, payment_ref, details, created_at")
    .eq("company_id", companyId)
    .order("period", { ascending: false })
    .limit(24);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ filings: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { yearMonth?: string; companyId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!body.yearMonth || !/^\d{4}-\d{2}$/.test(body.yearMonth)) {
    return NextResponse.json({ error: "yearMonth must be YYYY-MM" }, { status: 400 });
  }
  const companyId = body.companyId ?? (await getActiveCompanyId());

  try {
    const calc = await calculateSst(companyId, body.yearMonth);
    const persisted = await persistDraft(calc, auth.user.id);
    return NextResponse.json({ filing: { id: persisted.id, ...calc } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
