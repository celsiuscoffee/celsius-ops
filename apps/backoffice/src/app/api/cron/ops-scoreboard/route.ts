import { NextResponse } from "next/server";
import { runScoreboard } from "@/lib/ops-scoreboard";
import { cronRoute } from "@/lib/cron-monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/ops-scoreboard — the weekly performance scoreboard (4DX).
 *
 * Builds the role-scoped boards (per-cashier capture+upsell DM, per-outlet
 * leader digest + owner league) over the last 7 days and delivers them on
 * WhatsApp. Controlled by OPS_SCOREBOARD_MODE (off | shadow | armed); ships in
 * SHADOW — logs the boards it would send, sends nothing — until reviewed and the
 * ops_scoreboard template / a 24h window is confirmed.
 *
 * Design: docs/design/ops-performance-loop.md.
 */
async function runOpsScoreboard() {
  try {
    const result = await runScoreboard();
    console.log(
      `[cron/ops-scoreboard] mode=${result.mode} cashierBoards=${result.cashierBoards} leaders=${result.leaderRecipients} sent=${result.sent}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ops-scoreboard failed";
    console.error("[cron/ops-scoreboard]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = cronRoute("ops-scoreboard", runOpsScoreboard);
