import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getLeaderboard, proposeArms, getSendTimeLeaderboard, proposeSendWindow, composeMessage, getPausedLoops, SEND_WINDOWS, OFFER_CANDIDATES, LOOPS, ROUND_GAP_CAMPAIGNS, type LoopKey } from "@/lib/loyalty/loop-engine";

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
    const [leaderboard, proposalRaw, sendTimeLeaderboard, sendWindowProposal, paused] = await Promise.all([
      getLeaderboard(loopKey), proposeArms(loopKey), getSendTimeLeaderboard(loopKey), proposeSendWindow(loopKey), getPausedLoops(),
    ]);
    // round_gap doesn't use the A/B optimizer — it runs fixed per-segment campaigns
    // (ROUND_GAP_CAMPAIGNS). Surface THOSE as the "messages going out" so the UI
    // shows exactly what auto-run sends — paused arms filtered out, because they
    // are literally not going out.
    const proposal = loopKey === "round_gap"
      ? { arms: Object.values(ROUND_GAP_CAMPAIGNS).flatMap((cfg) => cfg.arms
          .filter((a) => !paused[`round_gap:${a.key}`])
          .map((a) => ({
          key: `${cfg.outlet}:${a.key}`,
          label: `${cfg.name} — ${a.label}`,
          voucher_template_id: "",
          message: a.message,
          role: a.key === "rg_import" ? "win-back" : "regular",
          reason: a.key === "rg_import" ? "dormant customers" : "regulars who skip this round",
        }))) }
      : proposalRaw;
    // Curate the swap-list copy for THIS objective — a candidate's message
    // reads as a Welcome/Birthday/etc. SMS, not the win-back default.
    const candidates = OFFER_CANDIDATES
      .filter((c) => def.candidateKeys.includes(c.key))
      .map((c) => ({ key: c.key, label: c.label, logic: c.logic, voucher_template_id: c.voucher_template_id, message: composeMessage(loopKey, c) }));
    // round_gap has no `trigger` (it runs on its own promo mechanic via
    // runRoundGapDaily) but IS auto-run daily — so present it as 'triggered'
    // (cards hidden, scorecard-only) like the lifecycle loops.
    // paused: full-loop pause reason (null = running). Round-gap arm pauses ride
    // along as pausedArms so the UI can flag a partially-paused loop honestly.
    const pausedArms = Object.fromEntries(Object.entries(paused).filter(([k]) => k.startsWith("round_gap:")).map(([k, v]) => [k.slice("round_gap:".length), v.reason]));
    const loops = Object.values(LOOPS).map((l) => ({
      key: l.key, label: l.label, objective: l.objective, defaultHoldoutPct: l.defaultHoldoutPct, defaultWindowDays: l.defaultWindowDays,
      triggered: !!l.trigger || l.key === "round_gap",
      paused: paused[l.key]?.reason ?? null,
      ...(l.key === "round_gap" && Object.keys(pausedArms).length ? { pausedArms } : {}),
    }));
    return NextResponse.json({
      loop_key: loopKey, leaderboard, proposal, candidates, loops,
      send_time_leaderboard: sendTimeLeaderboard, send_window_proposal: sendWindowProposal, send_windows: SEND_WINDOWS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load optimizer";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
