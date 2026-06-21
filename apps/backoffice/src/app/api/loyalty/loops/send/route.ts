import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { sendRound } from "@/lib/loyalty/loop-engine";

// POST /api/loyalty/loops/send — fire the SMS for a prepared round's treatment
// arms (holdout gets nothing). Call only after owner approval. Idempotent.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const { round_id } = await request.json();
    if (!round_id) return NextResponse.json({ error: "round_id required" }, { status: 400 });
    const res = await sendRound(round_id);
    return NextResponse.json(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to send round";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
