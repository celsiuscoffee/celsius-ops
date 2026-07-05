// GET /api/finance/reports/general-ledger
//
// Two calling conventions:
//   ?account=CODE&start=&end=            single account, original shape:
//                                        { report: GeneralLedger }
//   ?accounts=CODE1,CODE2&start=&end=    multi account (comma separated),
//                                        grouped per account:
//                                        { report: { companyId, start, end,
//                                          accounts: [{ account, opening,
//                                          entries, closing, totals }] } }
// companyId defaults to the active-company cookie.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildGeneralLedger, buildGeneralLedgerMulti } from "@/lib/finance/reports/gl-reports";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ACCOUNTS = 20;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  const accountsParam = url.searchParams.get("accounts");
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  if (!account && !accountsParam) return NextResponse.json({ error: "account code required" }, { status: 400 });
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "start, end (YYYY-MM-DD) required" }, { status: 400 });
  }
  try {
    if (accountsParam !== null) {
      const codes = [...new Set(accountsParam.split(",").map((s) => s.trim()).filter(Boolean))];
      if (codes.length === 0) return NextResponse.json({ error: "accounts must list at least one code" }, { status: 400 });
      if (codes.length > MAX_ACCOUNTS) return NextResponse.json({ error: `accounts is capped at ${MAX_ACCOUNTS} codes` }, { status: 400 });
      return NextResponse.json({ report: await buildGeneralLedgerMulti({ companyId, accountCodes: codes, start, end }) });
    }
    return NextResponse.json({ report: await buildGeneralLedger({ companyId, accountCode: account!, start, end }) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
