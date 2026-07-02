import { NextResponse, NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { recalcOutletParLevels } from "@/lib/inventory/par-calc";

// POST /api/inventory/par-levels/calculate — recalc one outlet's par levels
// on demand. The formula + engine-managed semantics live in
// lib/inventory/par-calc.ts (shared with the weekly cron/par-levels-recalc,
// which keeps pars from freezing the way they did after 2026-04-12).
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { outletId, lookbackDays, safetyDays, coverageDays } = body;

  if (!outletId) {
    return NextResponse.json({ error: "outletId is required" }, { status: 400 });
  }

  const result = await recalcOutletParLevels(outletId, { lookbackDays, safetyDays, coverageDays });
  if (!result.ok) {
    return NextResponse.json({ error: "No sales data found", message: result.error }, { status: 422 });
  }
  return NextResponse.json({ success: true, ...result });
}
