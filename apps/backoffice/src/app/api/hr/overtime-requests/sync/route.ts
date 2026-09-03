import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateOtRequests, syncWindow } from "@/lib/hr/ot-request-generator";

export const dynamic = "force-dynamic";

// Files PENDING post_hoc OT requests for every full-timer (person, day) whose
// clocked OT — the bracketed tail outside the rostered window, plus any
// threshold OT on the row — reaches 1h and has no request yet. The manager
// decides them in the OT queue (or, per owner 2026-09-03, by confirming the
// log on the attendance screen, which approves the tail directly).
//
// Until 2026-09-03 this selected logs by `overtime_hours >= 1`. That was the
// pre-paid-window signal and went ~permanently 0 on 13 Aug, so the queue
// silently emptied while managers thought attendance approval had paid the
// OT. See lib/hr/ot-request-generator.ts.
//
// FULL-TIMERS ONLY (owner policy 2026-07-28): part-timers are paid flat hourly
// on the weekly cycle — extra PT hours are handled via the roster.
//
// Scans the current month AND the previous one while it is still being paid
// (≤ 10th). POST accepts { month: "YYYY-MM" } to target one month explicitly.
//   POST — admin UI trigger (session-authed)
//   GET  — Vercel Cron trigger (Bearer CRON_SECRET)
async function runSync(actorUserId: string, month?: string | null) {
  const win = syncWindow(new Date(), month);
  try {
    const r = await generateOtRequests({ start: win.start, end: win.end, mode: "pending", actorUserId });
    return NextResponse.json({ ok: true, created: r.created, hours: r.hours, months: win.months });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Vercel Cron — Bearer CRON_SECRET
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSync("system");
}

// Manual admin trigger from UI
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const month = typeof body?.month === "string" ? body.month : null;
  return runSync(session.id, month);
}
