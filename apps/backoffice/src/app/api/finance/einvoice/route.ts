// GET  /api/finance/einvoice              — list submissions (last 100)
// POST /api/finance/einvoice/consolidated — body { yearMonth } → submit B2C consolidated for the month

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";
import { isEnabled as myinvoisEnabled } from "@/lib/finance/myinvois/client";
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
  // Filter via the join: fin_einvoice_submissions.invoice_id → fin_invoices.company_id.
  // Two-step query keeps it simple without depending on Supabase view.
  const { data: invoices } = await client
    .from("fin_invoices")
    .select("id")
    .eq("company_id", companyId)
    .limit(2000);
  const invoiceIds = (invoices ?? []).map((i) => i.id as string);
  if (invoiceIds.length === 0) {
    return NextResponse.json({ submissions: [], enabled: myinvoisEnabled() });
  }
  const { data, error } = await client
    .from("fin_einvoice_submissions")
    .select("id, invoice_id, myinvois_uuid, submission_id, status, submitted_at, validated_at, validation_results, qr_url, created_at")
    .in("invoice_id", invoiceIds)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    submissions: data ?? [],
    enabled: myinvoisEnabled(),
  });
}
