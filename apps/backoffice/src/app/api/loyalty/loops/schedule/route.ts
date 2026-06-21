import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { scheduleRound } from "@/lib/loyalty/loop-engine";

// POST /api/loyalty/loops/schedule — approve + schedule a prepared round to
// fire at a chosen time. The /api/cron/loops-send cron sends it when due.
// Body: { round_id, scheduled_send_at (ISO), send_window? }.
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  try {
    const { round_id, scheduled_send_at, send_window } = await request.json();
    if (!round_id || !scheduled_send_at) {
      return NextResponse.json({ error: "round_id and scheduled_send_at required" }, { status: 400 });
    }
    const res = await scheduleRound(round_id, scheduled_send_at, send_window ?? null);
    return NextResponse.json(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to schedule round";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
