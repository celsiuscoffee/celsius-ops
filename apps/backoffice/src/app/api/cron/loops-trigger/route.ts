import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { runTriggeredLoops, autoMeasureDueRounds, runRoundGapDaily, autoPauseUnderperformers } from "@/lib/loyalty/loop-engine";
import { runWeeklyReport } from "@/lib/loyalty/weekly-report";
import { touchAgentRun } from "@celsius/agents/src/substrate";
import { logAgentMessage } from "@celsius/agents/src/messages";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/loops-trigger — daily. Fires the auto-triggered lifecycle loops
// (birthday today / ~1 day after 1st visit / just-lapsed) by auto-issuing the
// voucher + sending the SMS to each newly-qualifying member. Also auto-measures
// any sent round whose attribution window has closed so the leaderboard learns
// without a manual click. No budget cap; cooldowns prevent double-targeting.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    // Order matters: measure closed windows first, then let the kill rule read
    // the freshest verdicts, so a loop/arm that just proved dead doesn't get
    // one more day of sends.
    const measured = await autoMeasureDueRounds();
    const autoPaused = await autoPauseUnderperformers();
    const triggered = await runTriggeredLoops();
    const roundGap = await runRoundGapDaily(); // per-segment promo loop (its own mechanic)
    // Mondays (MYT): send the owner's weekly Telegram scorecard AFTER the
    // day's measure/kill/send so it reads the freshest numbers. Rides this
    // cron on purpose — the repo runs a hard Vercel cron budget
    // (vercel-crons.test.ts), so the report doesn't get its own schedule.
    const isMondayMyt = new Date(Date.now() + 8 * 3600000).getUTCDay() === 1;
    const weeklyReport = isMondayMyt ? await runWeeklyReport().catch((e) => ({ ok: false, skipped: e instanceof Error ? e.message : "failed" })) : undefined;

    // Fleet visibility: both loops are armed but were never calling the
    // substrate, so /agents showed them as "never ran" and they posted nothing
    // to the feed. Heartbeat every run (even a quiet one) so the panel can tell
    // healthy-but-quiet from stopped; post one plain-English feed line only when
    // there was real activity (notify:false = shows on /agents + the daily
    // digest, no real-time ping). Never throws.
    await touchAgentRun("sms_lifecycle_loops");
    await touchAgentRun("round_gap_loop");
    const smsSent = triggered.reduce((n, r) => n + (r.sent ?? 0), 0);
    const smsQualified = triggered.reduce((n, r) => n + (r.qualified ?? 0), 0);
    if (smsSent > 0) {
      await logAgentMessage({
        fromAgent: "sms_lifecycle_loops",
        toAgent: "owner",
        kind: "report",
        summary: `Lifecycle loops sent ${smsSent} SMS today across birthday, first-visit and just-lapsed members (${smsQualified} qualified).`,
        detail: triggered.filter((r) => (r.sent ?? 0) > 0).map((r) => `${r.loop}: ${r.sent} sent`).join("; ") || undefined,
        notify: false,
      });
    }
    const gapSent = roundGap.reduce((n, r) => n + (r.sent ?? 0), 0);
    if (gapSent > 0) {
      await logAgentMessage({
        fromAgent: "round_gap_loop",
        toAgent: "owner",
        kind: "report",
        summary: `Round-gap loop sent ${gapSent} win-back SMS across ${roundGap.filter((r) => (r.sent ?? 0) > 0).length} segment(s) today.`,
        detail: roundGap.filter((r) => (r.sent ?? 0) > 0).map((r) => `${r.campaign}: ${r.sent} sent`).join("; ") || undefined,
        notify: false,
      });
    }

    return NextResponse.json({ triggered, roundGap, measured: measured.measured, autoPaused, ...(weeklyReport ? { weeklyReport } : {}) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops-trigger failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
