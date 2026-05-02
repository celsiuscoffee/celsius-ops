// GET /api/finance/reports/drilldown?accountCode=...&start=...&end=...&companyId=...

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { pnlDrillDown } from "@/lib/finance/reports/pnl";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";

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
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  if (!accountCode || !start || !end) {
    return NextResponse.json({ error: "accountCode, start, end required" }, { status: 400 });
  }
  const lines = await pnlDrillDown({ companyId, accountCode, start, end });
  return NextResponse.json({ accountCode, start, end, lines });
}
