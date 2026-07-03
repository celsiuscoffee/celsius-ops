// POST /api/finance/bank-lines/reject-match — record a human "no" on a match
// proposal. The pair disappears from Needs Review and the auto-apply cron
// skips it permanently (proposeApMatches filters rejected pairs).

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { bankLineId?: string; invoiceId?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body.bankLineId || !body.invoiceId) {
    return NextResponse.json({ error: "bankLineId and invoiceId required" }, { status: 400 });
  }
  const client = getFinanceClient();
  const { error } = await client.from("fin_ap_match_rejections").upsert(
    { bank_line_id: body.bankLineId, invoice_id: body.invoiceId, reason: "rejected" },
    { onConflict: "bank_line_id,invoice_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
