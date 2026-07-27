// GET /api/finance/cashflow/payables?days=7
// GET /api/finance/cashflow/payables?from=2026-08-01&to=2026-08-15
//
// Committed cash outflows per day: unpaid invoices on their due dates plus
// active recurring expenses expanded onto theirs, with a standing overdue
// block (past-due or undated invoices, relative to today). Custom from/to
// takes precedence over the days preset; the window is capped at 92 days
// (a 13-week quarter). Read-only.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildPayablesForecast, todayMyt } from "@/lib/finance/payables-forecast";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_DAYS = 92;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function addDaysStr(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const fromParam = params.get("from");
  const toParam = params.get("to");

  let from: string;
  let to: string;
  if (fromParam && toParam && YMD.test(fromParam) && YMD.test(toParam) && fromParam <= toParam) {
    from = fromParam;
    to = toParam;
    if (addDaysStr(from, MAX_DAYS - 1) < to) to = addDaysStr(from, MAX_DAYS - 1);
  } else {
    const daysRaw = Number(params.get("days") ?? 7);
    const days = Number.isFinite(daysRaw) ? Math.min(MAX_DAYS, Math.max(1, Math.trunc(daysRaw))) : 7;
    from = todayMyt();
    to = addDaysStr(from, days - 1);
  }

  try {
    const forecast = await buildPayablesForecast(from, to);
    return NextResponse.json({ forecast });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
