// GET /api/finance/companies — list active companies for the switcher,
// each with its outlet ids so UIs can scope outlet filters to the company.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listCompanies, getActiveCompanyId } from "@/lib/finance/companies";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const client = getFinanceClient();
  const [companies, activeId, oc] = await Promise.all([
    listCompanies(),
    getActiveCompanyId(),
    client.from("fin_outlet_companies").select("outlet_id, company_id"),
  ]);
  const outletsByCompany = new Map<string, string[]>();
  for (const r of oc.data ?? []) {
    const arr = outletsByCompany.get(r.company_id as string) ?? [];
    arr.push(r.outlet_id as string);
    outletsByCompany.set(r.company_id as string, arr);
  }
  return NextResponse.json({
    companies: companies.map((c) => ({ ...c, outletIds: outletsByCompany.get(c.id) ?? [] })),
    activeCompanyId: activeId,
  });
}
