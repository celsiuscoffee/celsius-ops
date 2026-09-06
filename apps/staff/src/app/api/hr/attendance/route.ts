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

  // Aggregate stats for the period. OT rules:
  //   1. Must be approved (AI or manager) — pending/flagged/rejected don't count
  //   2. Must be >= one 30-min bracket — matches payroll's OT_MIN_HOURS
  //      (owner 2026-09-03: "pay the 0.5h"; was 1h)
  const OT_MIN_HOURS = 0.5;
  const isApproved = (a: { ai_status: string | null; final_status: string | null }) =>
    a.ai_status === "approved" || a.final_status === "approved";
  const countableOT = (a: { overtime_hours: number | null }) => {
    const h = Number(a.overtime_hours) || 0;
    return h >= OT_MIN_HOURS ? h : 0;
  };
  const totalHours = (data || []).reduce((sum, a) => sum + (Number(a.total_hours) || 0), 0);
  const totalOT = (data || []).reduce(
    (sum, a) => sum + (isApproved(a) ? countableOT(a) : 0),
    0,
  );
  const pendingOT = (data || []).reduce(
    (sum, a) => sum + (!isApproved(a) ? countableOT(a) : 0),
    0,
  );
  // Distinct MYT calendar days worked (clock_in is UTC timestamptz; morning
  // shifts would otherwise fall on the previous UTC date).
  const daysWorked = new Set(
    (data || []).map((a) =>
      new Date(new Date(a.clock_in).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10),
    ),
  ).size;

  return NextResponse.json({
    logs: data || [],
    stats: {
      totalHours: Math.round(totalHours * 100) / 100,
      totalOT: Math.round(totalOT * 100) / 100,
      pendingOT: Math.round(pendingOT * 100) / 100,
      daysWorked,
      period: days,
    },
  });
}
