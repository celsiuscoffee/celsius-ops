// GET /api/finance/reports/pnl?start=YYYY-MM-DD&end=YYYY-MM-DD&companyId=...
// Optional byMonth=1 splits the range into calendar months (capped at the last
// 12) and returns one report per month alongside the full-period report.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildSourcedPnl, buildConsolidatedPnl, CONSOLIDATED_COMPANY_ID } from "@/lib/finance/reports/pnl-sourced";
import { getActiveCompanyId } from "@/lib/finance/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_MONTHS = 12;

// Split [start, end] into calendar-month windows. The first and last windows
// are clipped to the requested range so partial months report correctly.
function monthWindows(start: string, end: string): { month: string; start: string; end: string }[] {
  const out: { month: string; start: string; end: string }[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endY = Number(end.slice(0, 4));
  const endM = Number(end.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({
      month: ym,
      start: ym === start.slice(0, 7) ? start : `${ym}-01`,
      end: ym === end.slice(0, 7) ? end : `${ym}-${String(lastDay).padStart(2, "0")}`,
    });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// Run tasks with a small concurrency cap so a 12-month build does not fire
// every per-month query burst at the DB at once.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

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
  const byMonth = url.searchParams.get("byMonth") === "1";
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "start, end (YYYY-MM-DD) required" }, { status: 400 });
  }
  try {
    // companyId=consolidated → the GROUP statement: all companies summed with
    // inter-company legs eliminated (outlet filter doesn't apply).
    const build = (s: string, e: string) =>
      companyId === CONSOLIDATED_COMPANY_ID
        ? buildConsolidatedPnl({ start: s, end: e })
        : buildSourcedPnl({ companyId, start: s, end: e, outletId });

    if (byMonth) {
      let windows = monthWindows(start, end);
      const truncated = windows.length > MAX_MONTHS;
      if (truncated) windows = windows.slice(-MAX_MONTHS);
      const [report, monthReports] = await Promise.all([
        build(start, end),
        mapLimit(windows, 3, (w) => build(w.start, w.end)),
      ]);
      return NextResponse.json({
        report,
        months: windows.map((w, i) => ({ month: w.month, report: monthReports[i] })),
        ...(truncated ? { truncated: true } : {}),
      });
    }

    const report = await build(start, end);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
