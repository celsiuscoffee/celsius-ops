import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { sendDueRounds } from "@/lib/loyalty/loop-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET /api/cron/loops-send — fires any scheduled loop round whose send time has
// arrived. Runs every ~15 min (vercel.json). Approve-gated: only sends rounds an
// operator explicitly scheduled via /api/loyalty/loops/schedule.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });
  try {
    const res = await sendDueRounds();
    return NextResponse.json(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "loops-send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
