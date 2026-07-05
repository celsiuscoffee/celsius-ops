import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { timingSafeEqual } from "node:crypto";
import { getSession } from "@/lib/auth";
import { runCelsiusOverviewAgent } from "@/lib/ai-agent/celsius-overview";

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
    return NextResponse.json({
      ok: true,
      generatedAt: result.generatedAt,
      recommendationCount: result.recommendations.length,
      delivered: result.delivered,
      recommendations: result.recommendations,
      snapshot: result.snapshot,
    });
  } catch (err) {
    // Scheduled 4×/day — a failure here previously died in Vercel logs.
    Sentry.captureException(err, { tags: { cron: "celsius-overview" } });
    await Sentry.flush(2000);
    console.error("[ai-agent] run failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = runHandler;
export const POST = runHandler;
