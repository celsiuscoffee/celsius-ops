import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { cancelRound } from "@/lib/loyalty/loop-engine";

// POST /api/loyalty/loops/cancel — revert a PREPARED round (delete its un-sent
// vouchers + assignments + the round). Body: { round_id }. Rejects sent/measured
// rounds (SMS already out).
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const { round_id } = await request.json();
    if (!round_id) return NextResponse.json({ error: "round_id required" }, { status: 400 });
    const res = await cancelRound(round_id);
    return NextResponse.json(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to cancel round";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
