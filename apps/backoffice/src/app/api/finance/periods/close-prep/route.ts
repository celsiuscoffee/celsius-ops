// GET /api/finance/periods/close-prep?period=YYYY-MM
//
// The close-readiness checklist for every legal entity: statements coverage,
// classification, payroll actuals, plus the management-fee accrual and
// depreciation the Close agent would post. The compliance page renders this;
// the day-1 cron sends its summary to Telegram.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listCompanies } from "@/lib/finance/companies";
import { prepareClose } from "@/lib/finance/close-prep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function lastMonth(): string {
  const d = new Date(Date.now() + 8 * 3600_000); // MYT
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? lastMonth();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }

  try {
    const companies = await listCompanies();
    const preps = await Promise.all(
      companies.map((c) => prepareClose(c.id, c.name, period)),
    );
    return NextResponse.json({ period, companies: preps });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
