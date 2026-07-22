// GET /api/finance/cashflow/incoming?days=7
//
// Expected cash landing over the next N days, per day / channel / entity, using
// each channel's real settlement calendar (see lib/finance/settlement-forecast).
// Booked = sales already rung awaiting settlement; projected = future sales at
// the trailing run-rate. Read-only.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildIncomingForecast } from "@/lib/finance/settlement-forecast";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const daysRaw = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const days = Number.isFinite(daysRaw) ? Math.min(28, Math.max(1, Math.trunc(daysRaw))) : 7;

  const todayMyt = new Date(Date.now() + 8 * 3600_000);
  const from = todayMyt.toISOString().slice(0, 10);
  const end = new Date(todayMyt);
  end.setUTCDate(end.getUTCDate() + days - 1);
  const to = end.toISOString().slice(0, 10);

  try {
    const forecast = await buildIncomingForecast(from, to);
    return NextResponse.json({ forecast });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
