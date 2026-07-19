import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { getAccessibleOutletIds } from "@/lib/hr/scope";
import { breakHoursFor, mytDateString } from "@/lib/hr/hours";
import { ptRateForDate } from "@/lib/hr/pt-rate";

export const dynamic = "force-dynamic";

// Manager confirmation of PT clocked hours — the gate before the weekly
// payment file (owner rule 2026-07-19: "managers need to confirm each PT
// hours first before paying").
//
// GET  ?week_start=YYYY-MM-DD[&outlet_id=…] → per-PT clock logs for the MYT
//      week with worked hours, the day's rate (weekday/weekend/PH 2×), pay
//      preview and confirmation state. Managers see only their outlets.
// POST { action: "confirm", log_ids: string[] } → marks clean logs
//      manager-approved (final_status). Flagged/adjusted/rejected logs keep
//      their existing review flow in HR → Attendance; rejecting here uses the
//      same per-log PATCH the attendance queue uses.

type LogRow = {
  id: string; user_id: string; outlet_id: string | null;
  clock_in: string; clock_out: string | null; total_hours: number | string | null;
  ai_status: string | null; ai_flags: string[] | null; final_status: string | null;
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const weekStart = sp.get("week_start");
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: "week_start (YYYY-MM-DD Monday) required" }, { status: 400 });
  }
  const weekEnd = new Date(`${weekStart}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const requestedOutletId = sp.get("outlet_id");
  const allowed = await getAccessibleOutletIds(session);
  let outletFilter: string[] | null = null;
  if (allowed === null) {
    outletFilter = requestedOutletId ? [requestedOutletId] : null;
  } else {
    if (allowed.length === 0) return NextResponse.json({ pts: [] });
    outletFilter = requestedOutletId && allowed.includes(requestedOutletId) ? [requestedOutletId] : allowed;
  }

  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, hourly_rate, hourly_rate_weekend, employment_type")
    .in("employment_type", ["part_time", "intern"]);
  const profMap = new Map(((profiles ?? []) as Array<{ user_id: string; hourly_rate: number | null; hourly_rate_weekend: number | null }>).map((p) => [p.user_id, p]));
  const ptIds = [...profMap.keys()];
  if (ptIds.length === 0) return NextResponse.json({ pts: [] });

  let logQuery = hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id, user_id, outlet_id, clock_in, clock_out, total_hours, ai_status, ai_flags, final_status")
    .in("user_id", ptIds)
    .gte("clock_in", `${weekStart}T00:00:00+08:00`)
    .lte("clock_in", `${weekEndStr}T23:59:59+08:00`)
    .not("clock_out", "is", null)
    .order("clock_in");
  if (outletFilter !== null) logQuery = logQuery.in("outlet_id", outletFilter);
  const { data: logsRaw } = await logQuery;
  const logs = (logsRaw ?? []) as LogRow[];
  if (logs.length === 0) return NextResponse.json({ pts: [] });

  const { data: hols } = await hrSupabaseAdmin
    .from("hr_public_holidays").select("date").gte("date", weekStart).lte("date", weekEndStr);
  const holidaySet = new Set(((hols ?? []) as Array<{ date: string }>).map((h) => h.date));

  const userIds = [...new Set(logs.map((l) => l.user_id))];
  const outletIds = [...new Set(logs.map((l) => l.outlet_id).filter(Boolean))] as string[];
  const [users, outlets] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, fullName: true } }),
    outletIds.length ? prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  const byUser = new Map<string, Array<Record<string, unknown>>>();
  for (const l of logs) {
    const prof = profMap.get(l.user_id)!;
    const totalH = l.total_hours != null
      ? Number(l.total_hours)
      : Math.max(0, (new Date(l.clock_out as string).getTime() - new Date(l.clock_in).getTime()) / 3600000);
    const worked = Math.max(0, Math.round((totalH - breakHoursFor("part_time", totalH)) * 100) / 100);
    const dateStr = mytDateString(l.clock_in);
    const rate = ptRateForDate(prof, dateStr, holidaySet.has(dateStr));
    const confirmed = l.final_status === "approved" || l.final_status === "adjusted";
    const state = l.final_status === "rejected" ? "rejected"
      : confirmed ? "confirmed"
      : (l.ai_status === "flagged" ? "flagged" : "pending");
    (byUser.get(l.user_id) ?? byUser.set(l.user_id, []).get(l.user_id)!).push({
      id: l.id, date: dateStr,
      clock_in: l.clock_in, clock_out: l.clock_out,
      worked_hours: worked, rate, pay: Math.round(worked * rate * 100) / 100,
      is_weekend_rate: rate !== (Number(prof.hourly_rate) || 0) && !holidaySet.has(dateStr),
      is_holiday: holidaySet.has(dateStr),
      state, ai_flags: l.ai_flags ?? [],
      outlet_name: l.outlet_id ? outletMap.get(l.outlet_id) ?? null : null,
    });
  }

  const pts = [...byUser.entries()].map(([uid, rows]) => {
    const u = userMap.get(uid);
    const payable = rows.filter((r) => r.state !== "rejected");
    return {
      user_id: uid,
      name: u?.fullName || u?.name || uid.slice(0, 8),
      logs: rows,
      total_hours: Math.round(payable.reduce((s, r) => s + (r.worked_hours as number), 0) * 100) / 100,
      total_pay: Math.round(payable.reduce((s, r) => s + (r.pay as number), 0) * 100) / 100,
      pending: rows.filter((r) => r.state === "pending" || r.state === "flagged").length,
    };
  }).sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));

  return NextResponse.json({ pts, week_start: weekStart, week_end: weekEndStr });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { action, log_ids } = (await req.json()) as { action: string; log_ids: string[] };
  if (action !== "confirm" || !Array.isArray(log_ids) || log_ids.length === 0) {
    return NextResponse.json({ error: "action 'confirm' with log_ids[] required" }, { status: 400 });
  }
  if (log_ids.length > 200) {
    return NextResponse.json({ error: "Too many logs in one confirm (max 200)" }, { status: 400 });
  }

  const { data: logsRaw } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id, outlet_id, final_status")
    .in("id", log_ids);
  const logs = (logsRaw ?? []) as Array<{ id: string; outlet_id: string | null; final_status: string | null }>;

  const allowed = await getAccessibleOutletIds(session);
  const confirmable = logs.filter((l) => {
    if (l.final_status === "rejected" || l.final_status === "adjusted") return false; // keep stronger verdicts
    if (allowed !== null && (!l.outlet_id || !allowed.includes(l.outlet_id))) return false; // manager scope
    return true;
  });
  if (confirmable.length === 0) {
    return NextResponse.json({ error: "No confirmable logs (out of scope or already resolved)" }, { status: 403 });
  }

  const { error } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .update({
      final_status: "approved",
      ai_status: "reviewed",
      reviewed_by: session.id,
      reviewed_at: new Date().toISOString(),
      review_notes: "PT hours confirmed for weekly payroll",
    })
    .in("id", confirmable.map((l) => l.id));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ confirmed: confirmable.length, skipped: log_ids.length - confirmable.length });
}
