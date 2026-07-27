import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runWeeklyReport } from "@/lib/loyalty/weekly-report";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GET /api/cron/loops-weekly-report — manual/backup trigger for the weekly
// Telegram scorecard. NOT in vercel.json (the repo runs a hard cron budget —
// vercel-crons.test.ts); the scheduled Monday send rides the daily
// loops-trigger cron instead. This endpoint exists for re-sends and testing.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    const res = await runWeeklyReport();
    return NextResponse.json(res, { status: res.ok || res.skipped ? 200 : 500 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops-weekly-report failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
