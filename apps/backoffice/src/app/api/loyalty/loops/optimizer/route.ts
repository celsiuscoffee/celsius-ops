import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLeaderboard, proposeArms, OFFER_CANDIDATES } from "@/lib/loyalty/loop-engine";

// GET /api/loyalty/loops/optimizer — the adaptive layer for the dashboard:
//   - leaderboard: every offer ranked by cumulative incremental margin (learns over time)
//   - proposal:    the next round's champion + challengers (engine's suggestion)
//   - candidates:  the full offer space, so the operator can swap an arm
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const [leaderboard, proposal] = await Promise.all([getLeaderboard(), proposeArms()]);
    return NextResponse.json({ leaderboard, proposal, candidates: OFFER_CANDIDATES });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load optimizer";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
