import { NextResponse } from "next/server";

// Lightweight health check for uptime monitoring (BetterUptime,
// Pingdom, UptimeRobot, etc.). Returns 200 OK with build identifiers
// when the app is reachable. No DB / external dependency check —
// keeping this fast (sub-100ms) so the monitor can probe frequently
// without affecting the app's serverless budget.
//
// If you want a deep-health check (DB ping, Redis ping, etc.) wire
// it on a separate /api/health/deep endpoint and probe less often.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      // Vercel sets these automatically on every deploy
      sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
