import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSession } from "@/lib/auth";
import { runCelsiusOverviewAgent } from "@/lib/ai-agent/celsius-overview";
import { runCommsDigest } from "@celsius/agents/src/digest";
import { touchAgentRun } from "@celsius/agents/src/substrate";
import { runIntelligenceBriefing } from "@/lib/agents/intelligence-briefing";
import { runOpsIntelligence } from "@/lib/ops/ops-intelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeSecretMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST /api/ai-agent/celsius-overview
 *
 * Runs the Celsius Coffee AI agent. Either authenticated as OWNER/ADMIN
 * (manual trigger) or invoked by Vercel Cron with the CRON_SECRET bearer.
 *
 * Query params:
 *   skipTelegram=true  — don't send to Telegram (dashboard refresh use case)
 *
 * GET returns the latest cached result without re-running the agent.
 */
async function runHandler(req: NextRequest) {
  const cronSecret = req.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = safeSecretMatch(cronSecret, process.env.CRON_SECRET);

  if (!isCron) {
    const session = await getSession();
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const skipTelegram = new URL(req.url).searchParams.get("skipTelegram") === "true";

  try {
    const result = await runCelsiusOverviewAgent({ sendTelegram: !skipTelegram });

    // Fold the once-a-day agent-comms digest into this cron's 9pm MYT (13:00
    // UTC) firing instead of spending a separate Vercel cron slot (project is
    // near the 40-cron cap). Best-effort: a digest failure never fails the
    // overview run.
    if (isCron && new Date().getUTCHours() === 13) {
      try {
        // Heartbeat here, not in the unscheduled /api/cron/agent-comms-digest
        // route — this fold is the only path that actually runs the digest.
        await touchAgentRun("agent_comms_digest");
        await runCommsDigest();
      } catch (digestErr) {
        console.error("[ai-agent] folded comms-digest failed:", digestErr);
      }
    }

    // Fold the proactive morning briefing into this cron's 9am MYT (01:00 UTC)
    // firing - the intelligence agent messages the owner first with yesterday's
    // numbers, anomalies, and pace vs target. Best-effort; never fails the run.
    if (isCron && new Date().getUTCHours() === 1) {
      try {
        await runIntelligenceBriefing();
      } catch (briefErr) {
        console.error("[ai-agent] folded morning-briefing failed:", briefErr);
      }
    }

    // Weekly ops read: Mondays on the 1pm-MYT (05:00 UTC) firing, clear of the
    // morning briefing and the evening comms digest so the owner's Telegram
    // isn't three long messages at once. Best-effort; never fails the run.
    if (isCron && new Date().getUTCHours() === 5 && new Date(Date.now() + 8 * 3600000).getUTCDay() === 1) {
      try {
        await runOpsIntelligence();
      } catch (opsErr) {
        console.error("[ai-agent] folded ops-intelligence failed:", opsErr);
      }
    }

    return NextResponse.json({
      ok: true,
      generatedAt: result.generatedAt,
      recommendationCount: result.recommendations.length,
      delivered: result.delivered,
      recommendations: result.recommendations,
      snapshot: result.snapshot,
    });
  } catch (err) {
    console.error("[ai-agent] run failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = runHandler;
export const POST = runHandler;
