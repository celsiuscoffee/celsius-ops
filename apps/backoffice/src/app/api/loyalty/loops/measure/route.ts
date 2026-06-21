import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { measureRound } from "@/lib/loyalty/loop-engine";

// POST /api/loyalty/loops/measure — after the attribution window, compute
// per-arm conversion + redemption vs the holdout for a round.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const { round_id } = await request.json();
    if (!round_id) return NextResponse.json({ error: "round_id required" }, { status: 400 });
    const res = await measureRound(round_id);
    return NextResponse.json(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to measure round";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
