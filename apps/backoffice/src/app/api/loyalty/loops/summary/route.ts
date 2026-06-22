import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getEvaluation } from "@/lib/loyalty/loop-engine";

// GET /api/loyalty/loops/summary — cross-loop evaluation rollup for the
// campaigns overview dashboard (grand totals + per-loop breakdown).
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await getEvaluation());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load evaluation";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
