// GET /api/finance/reports/pnl?start=YYYY-MM-DD&end=YYYY-MM-DD&companyId=...

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildSourcedPnl, buildConsolidatedPnl, CONSOLIDATED_COMPANY_ID } from "@/lib/finance/reports/pnl-sourced";
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
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const companyId = url.searchParams.get("companyId") ?? (await getActiveCompanyId());
  const outletId = url.searchParams.get("outletId") ?? undefined;
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "start, end (YYYY-MM-DD) required" }, { status: 400 });
  }
  try {
    // companyId=consolidated → the GROUP statement: all companies summed with
    // inter-company legs eliminated (outlet filter doesn't apply).
    const report = companyId === CONSOLIDATED_COMPANY_ID
      ? await buildConsolidatedPnl({ start, end })
      : await buildSourcedPnl({ companyId, start, end, outletId });
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
