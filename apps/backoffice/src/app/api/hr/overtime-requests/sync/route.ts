import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// Scans attendance logs for the current month with overtime_hours >= 1 and
// creates pending post_hoc OT requests for any that don't already have one.
// Manager then reviews them via the standard OT request flow.
//   POST — admin UI trigger (session-authed)
//   GET  — Vercel Cron trigger (Bearer CRON_SECRET)
async function runSync(actorUserId: string) {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEnd = nextMonth.toISOString().slice(0, 10);

  // All attendance logs in the month with OT >= 1 hour
  const { data: logs } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id, user_id, outlet_id, clock_in, overtime_hours, overtime_type")
    .gte("clock_in", `${monthStart}T00:00:00Z`)
    .lt("clock_in", `${monthEnd}T00:00:00Z`)
    .gte("overtime_hours", 1);

  if (!logs || logs.length === 0) {
    return NextResponse.json({ ok: true, created: 0 });
  }

  // Existing OT requests in the month so we don't duplicate.
  // Keyed by "user_id|date" — one request per staff per day max.
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("user_id, date")
    .gte("date", monthStart)
    .lt("date", monthEnd);
  const existingKeys = new Set((existing || []).map((r) => `${r.user_id}|${r.date}`));

  // MYT date conversion (clock_in is UTC timestamptz)
  const toMytDate = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  // Map attendance overtime_type → hr_overtime_requests.ot_type (different enums)
  const mapOtType = (raw: string | null | undefined): string => {
    switch (raw) {
      case "ot_1x":
      case "rest_day_1x":
        return "1x";
      case "ot_2x":
        return "2x";
      case "ot_3x":
      case "ph_2x":
        return "3x";
      case "rest_day":
        return "rest_day";
      case "public_holiday":
        return "public_holiday";
      case "ot_1_5x":
      default:
        return "1.5x";
    }
  };

  // Aggregate per user per date (sum OT hours)
  const agg = new Map<string, { user_id: string; outlet_id: string | null; date: string; hours: number; ot_type: string }>();
  for (const l of logs) {
    const date = toMytDate(l.clock_in);
    const key = `${l.user_id}|${date}`;
    if (existingKeys.has(key)) continue;
    const row = agg.get(key) || {
      user_id: l.user_id,
      outlet_id: l.outlet_id,
      date,
      hours: 0,
      ot_type: mapOtType(l.overtime_type),
    };
    row.hours += Number(l.overtime_hours) || 0;
    agg.set(key, row);
  }

  if (agg.size === 0) {
    return NextResponse.json({ ok: true, created: 0 });
  }

  const inserts = Array.from(agg.values()).map((a) => ({
    user_id: a.user_id,
    outlet_id: a.outlet_id,
    date: a.date,
    request_type: "post_hoc" as const,
    hours_requested: Math.round(a.hours * 100) / 100,
    ot_type: a.ot_type,
    reason: "Auto-created from attendance log (OT detected)",
    status: "pending" as const,
    requested_by: actorUserId,
  }));

  const { error } = await hrSupabaseAdmin.from("hr_overtime_requests").insert(inserts);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, created: inserts.length });
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
export async function POST() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSync(session.id);
}
