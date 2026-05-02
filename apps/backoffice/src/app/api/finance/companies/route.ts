// GET /api/finance/companies — list active companies for the switcher

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listCompanies, getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [companies, activeId] = await Promise.all([listCompanies(), getActiveCompanyId()]);
  return NextResponse.json({ companies, activeCompanyId: activeId });
}
