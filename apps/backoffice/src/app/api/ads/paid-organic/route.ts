import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { buildPaidOrganicReport } from "@/lib/ads/paid-organic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/ads/paid-organic?days=30 — per search term: paid spend vs organic
// geogrid rank, with an exclude/keep verdict. Read-only; exclusions go through
// the approval-gated POST /api/ads/paid-organic/exclude.
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const daysParam = Number(new URL(request.url).searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam >= 7 && daysParam <= 180 ? daysParam : 30;

  const report = await buildPaidOrganicReport(days);
  return NextResponse.json(report);
}
