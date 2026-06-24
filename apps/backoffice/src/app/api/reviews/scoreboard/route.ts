import { NextRequest, NextResponse } from "next/server";
import { getUserFromHeaders } from "@/lib/auth";
import { buildScoreboard } from "@/lib/reviews/scoreboard";

export const dynamic = "force-dynamic";

// GET /api/reviews/scoreboard — per-outlet daily review lever (velocity, gap,
// target reviews/day). Computed from ReviewDailySnapshot rows.
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await buildScoreboard();
  return NextResponse.json({ rows, placesConfigured: !!process.env.GOOGLE_PLACES_API_KEY });
}
