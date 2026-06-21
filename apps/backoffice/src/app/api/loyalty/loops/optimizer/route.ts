import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLeaderboard, proposeArms, OFFER_CANDIDATES, LOOPS, type LoopKey } from "@/lib/loyalty/loop-engine";

// GET /api/loyalty/loops/optimizer?loop_key= — the adaptive layer per loop:
//   - leaderboard: every offer ranked by cumulative incremental margin (learns over time)
//   - proposal:    the next round's champion + challengers (engine's suggestion)
//   - candidates:  this loop's offer subset, so the operator can swap an arm
//   - loops:       the registry, so the dashboard can render the objective selector
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const loopKey = (new URL(request.url).searchParams.get("loop_key") ?? "winback") as LoopKey;
    const def = LOOPS[loopKey];
    if (!def) return NextResponse.json({ error: `unknown loop: ${loopKey}` }, { status: 400 });
    const [leaderboard, proposal] = await Promise.all([getLeaderboard(loopKey), proposeArms(loopKey)]);
    const candidates = OFFER_CANDIDATES.filter((c) => def.candidateKeys.includes(c.key));
    const loops = Object.values(LOOPS).map((l) => ({ key: l.key, label: l.label, objective: l.objective, defaultHoldoutPct: l.defaultHoldoutPct, defaultWindowDays: l.defaultWindowDays }));
    return NextResponse.json({ loop_key: loopKey, leaderboard, proposal, candidates, loops });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load optimizer";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
