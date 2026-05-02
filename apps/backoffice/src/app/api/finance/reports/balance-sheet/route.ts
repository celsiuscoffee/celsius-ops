// GET /api/finance/reports/balance-sheet?asOf=YYYY-MM-DD&companyId=...

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildBalanceSheet } from "@/lib/finance/reports/balance-sheet";
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
  const asOf = url.searchParams.get("asOf");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: "asOf (YYYY-MM-DD) required" }, { status: 400 });
  }
  try {
    const report = await buildBalanceSheet({ companyId, asOf });
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
