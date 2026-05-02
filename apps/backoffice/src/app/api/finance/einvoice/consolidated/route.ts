// POST /api/finance/einvoice/consolidated
// Body: { yearMonth: "YYYY-MM" }
// Builds + submits one consolidated B2C e-invoice per outlet for the month.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { submitConsolidatedMonth } from "@/lib/finance/agents/compliance";
import { isEnabled } from "@/lib/finance/myinvois/client";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isEnabled()) {
    return NextResponse.json(
      { error: "MyInvois not configured. Set MYINVOIS_ENV + credentials." },
      { status: 503 }
    );
  }

  let body: { yearMonth?: string; companyId?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  if (!body.yearMonth || !/^\d{4}-\d{2}$/.test(body.yearMonth)) {
    return NextResponse.json({ error: "yearMonth must be YYYY-MM" }, { status: 400 });
  }
  const companyId = body.companyId ?? (await getActiveCompanyId());

  try {
    const result = await submitConsolidatedMonth(companyId, body.yearMonth, auth.user.id);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
