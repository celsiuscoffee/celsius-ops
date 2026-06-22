import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLeaderboard, proposeArms, getSendTimeLeaderboard, proposeSendWindow, composeMessage, SEND_WINDOWS, OFFER_CANDIDATES, LOOPS, type LoopKey } from "@/lib/loyalty/loop-engine";

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
    const [leaderboard, proposal, sendTimeLeaderboard, sendWindowProposal] = await Promise.all([
      getLeaderboard(loopKey), proposeArms(loopKey), getSendTimeLeaderboard(loopKey), proposeSendWindow(loopKey),
    ]);
    // Curate the swap-list copy for THIS objective — a candidate's message
    // reads as a Welcome/Birthday/etc. SMS, not the win-back default.
    const candidates = OFFER_CANDIDATES
      .filter((c) => def.candidateKeys.includes(c.key))
      .map((c) => ({ key: c.key, label: c.label, logic: c.logic, voucher_template_id: c.voucher_template_id, message: composeMessage(loopKey, c) }));
    const loops = Object.values(LOOPS).map((l) => ({ key: l.key, label: l.label, objective: l.objective, defaultHoldoutPct: l.defaultHoldoutPct, defaultWindowDays: l.defaultWindowDays, triggered: !!l.trigger }));
    return NextResponse.json({
      loop_key: loopKey, leaderboard, proposal, candidates, loops,
      send_time_leaderboard: sendTimeLeaderboard, send_window_proposal: sendWindowProposal, send_windows: SEND_WINDOWS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load optimizer";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
