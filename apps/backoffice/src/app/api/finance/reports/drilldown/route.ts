// GET /api/finance/reports/drilldown?accountCode=...&start=...&end=...&companyId=...&outletId=...
//
// Two kinds of code arrive here: real GL account codes (Balance Sheet / ledger
// P&L) drill into fin_journal_lines; the sourced P&L's synthetic codes (REV-*,
// PROC, MKT-*, BANK:*) drill into the operational records the line was built
// from — the ledger has no rows for those, so they'd otherwise come back empty.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { pnlDrillDown } from "@/lib/finance/reports/pnl";
import { sourcedPnlDrillDown, isSourcedPnlCode } from "@/lib/finance/reports/pnl-sourced-drill";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const accountCode = url.searchParams.get("accountCode");
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const outletId = url.searchParams.get("outletId");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  if (!accountCode || !start || !end) {
    return NextResponse.json({ error: "accountCode, start, end required" }, { status: 400 });
  }
  const lines = isSourcedPnlCode(accountCode)
    ? await sourcedPnlDrillDown({ companyId, code: accountCode, start, end, outletId })
    : await pnlDrillDown({ companyId, accountCode, start, end });
  return NextResponse.json({ accountCode, start, end, lines });
}
