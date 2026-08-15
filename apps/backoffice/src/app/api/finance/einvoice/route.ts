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
  // fin_invoices is dead/tombstoned; list submissions directly. Company
  // scoping returns with the (company, outlet, period) re-key in phase 2
  // (docs/design/einvoice-live-sources.md) — the table is empty until then,
  // so an unscoped list is exact today.
  void companyId;
  const { data, error } = await client
    .from("fin_einvoice_submissions")
    .select("id, invoice_id, myinvois_uuid, submission_id, status, submitted_at, validated_at, validation_results, qr_url, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    submissions: data ?? [],
    enabled: myinvoisEnabled(),
  });
}
