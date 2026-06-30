// GET /api/finance/reports/general-ledger?account=CODE&start=&end=&companyId=...

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildGeneralLedger } from "@/lib/finance/reports/gl-reports";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  if (!account) return NextResponse.json({ error: "account code required" }, { status: 400 });
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "start, end (YYYY-MM-DD) required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ report: await buildGeneralLedger({ companyId, accountCode: account, start, end }) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
