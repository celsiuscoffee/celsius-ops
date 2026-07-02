import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { buildAdsOptimizerReport } from "@/lib/ads/optimizer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/ads/optimizer?days=30 — per campaign: how much daily budget can be
// reclaimed (waste you own organically + the least-efficient marginal spend),
// with the conversions each trim gives up. Read-only; cuts go through the
// approval-gated POST /api/ads/optimizer/apply-budget.
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const daysParam = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam >= 7 && daysParam <= 180 ? daysParam : 30;

  const report = await buildAdsOptimizerReport(days);
  return NextResponse.json(report);
}
