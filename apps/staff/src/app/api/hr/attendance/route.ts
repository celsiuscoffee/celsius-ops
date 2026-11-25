import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role: the route authenticates via getSession and filters every query
// by session.id, so it doesn't rely on RLS. Using the anon client would break
// once RLS is enabled on hr_attendance_logs (migration 064) — no anon policy.
import { supabaseAdmin as supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my attendance history
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get("days") || "30");

  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from("hr_attendance_logs")
    .select("id, clock_in, clock_out, total_hours, regular_hours, overtime_hours, overtime_type, ai_status, ai_flags, final_status, outlet_id")
    .eq("user_id", session.id)
    .gte("clock_in", since.toISOString())
    // Synthetic OT-approval rows (09:00, no hours) are not the person's
    // clock-ins; they showed as a phantom day in the list and in daysWorked.
    .neq("clock_in_method", "ot_approval")
    .order("clock_in", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Overtime, shown the way Gosamē's Staff app shows it (owner 20 Nov 2026):
  // approved hours, plus the hours still waiting for a manager on the
  // Overtime page. Since 19 Nov a clocked OT tail is not on the log until it
  // is approved there — the pending part lives in hr_overtime_requests.
  //   1. Approved = payroll's rule: the manager's decision wins; the AI's
  //      approval counts only while no manager has decided.
  //   2. At least one 30-min bracket (owner 2026-09-03: "pay the 0.5h").
  const OT_MIN_HOURS = 0.5;
  const toHalf = (h: unknown) => Math.floor((Number(h) || 0) * 2) / 2;
  const isApproved = (a: { ai_status: string | null; final_status: string | null }) =>
    a.final_status === "approved" || a.final_status === "adjusted" || (a.ai_status === "approved" && !a.final_status);
  const countableOT = (a: { overtime_hours: number | null }) => {
    const h = toHalf(a.overtime_hours);
    return h >= OT_MIN_HOURS ? h : 0;
  };
  const totalHours = (data || []).reduce((sum, a) => sum + (Number(a.total_hours) || 0), 0);
  const totalOT = (data || []).reduce(
    (sum, a) => sum + (isApproved(a) && a.final_status !== "rejected" ? countableOT(a) : 0),
    0,
  );
  const mytDay = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: pendingReqs } = await supabase
    .from("hr_overtime_requests")
    .select("date, hours_requested")
    .eq("user_id", session.id)
    .eq("status", "pending")
    .gte("date", mytDay(since.toISOString()));
  const pendingByDate: Record<string, number> = {};
  for (const r of (pendingReqs || []) as { date: string; hours_requested: number | null }[]) {
    const h = toHalf(r.hours_requested);
    if (h >= OT_MIN_HOURS) pendingByDate[r.date] = (pendingByDate[r.date] ?? 0) + h;
  }
  const pendingOT = Object.values(pendingByDate).reduce((s, h) => s + h, 0);
  // Distinct MYT calendar days worked (clock_in is UTC timestamptz; morning
  // shifts would otherwise fall on the previous UTC date).
  const daysWorked = new Set(
    (data || []).map((a) =>
      new Date(new Date(a.clock_in).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10),
    ),
  ).size;

  return NextResponse.json({
    logs: data || [],
    // OT waiting for a manager, by Malaysia date (YYYY-MM-DD).
    pendingOtByDate: pendingByDate,
    stats: {
      totalHours: Math.round(totalHours * 100) / 100,
      totalOT: Math.round(totalOT * 100) / 100,
      pendingOT: Math.round(pendingOT * 100) / 100,
      daysWorked,
      period: days,
    },
  });
}
