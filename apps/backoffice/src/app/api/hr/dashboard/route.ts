import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET: HR dashboard stats
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const outletFilter = session.role === "MANAGER" && session.outletId
    ? { outlet_id: session.outletId }
    : {};

  const [flaggedRes, leaveRes, scheduleRes, payrollRes, agentRes, probationRes] = await Promise.all([
    // Flagged attendance count
    hrSupabaseAdmin
      .from("hr_attendance_logs")
      .select("id", { count: "exact", head: true })
      .eq("ai_status", "flagged")
      .match(outletFilter),

    // Leave requests waiting on a human: escalated by the AI, or never
    // processed at all. Two sick-leave requests sat at "pending" for a month
    // (Aug 2026) because only ai_escalated was counted here.
    hrSupabaseAdmin
      .from("hr_leave_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["ai_escalated", "pending"]),

    // Current week schedule status
    (() => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const weekStart = monday.toISOString().slice(0, 10);
      return hrSupabaseAdmin
        .from("hr_schedules")
        .select("status")
        .eq("week_start", weekStart)
        .limit(1)
        .maybeSingle();
    })(),

    // Current month payroll status
    (() => {
      const now = new Date();
      return hrSupabaseAdmin
        .from("hr_payroll_runs")
        .select("status")
        .eq("period_month", now.getMonth() + 1)
        .eq("period_year", now.getFullYear())
        .limit(1)
        .maybeSingle();
    })(),

    // Last agent run
    hrSupabaseAdmin
      .from("hr_agent_runs")
      .select("agent_type, status, completed_at, items_processed, items_flagged, items_auto_approved")
      .eq("agent_type", "attendance_processor")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Full-timers still on probation — confirmed_at is the ONLY thing that ends
    // probation (owner 2026-08-03), and while it is unset payroll withholds the
    // performance allowance. There is no other worklist for this: the banner
    // lives on the individual profile, so an unnoticed probation silently costs
    // the staffer money every month.
    hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("user_id")
      .eq("employment_type", "full_time")
      .is("confirmed_at", null)
      .is("resigned_at", null)
      .is("end_date", null),
  ]);

  // Deactivated users can linger with a live-looking profile (no resigned_at) —
  // count only ACTIVE accounts.
  const probationIds = (probationRes.data || []).map((p: { user_id: string }) => p.user_id);
  const onProbation = probationIds.length
    ? await prisma.user.count({ where: { id: { in: probationIds }, status: "ACTIVE" } })
    : 0;

  return NextResponse.json({
    flaggedAttendance: flaggedRes.count || 0,
    escalatedLeave: leaveRes.count || 0,
    scheduleStatus: scheduleRes.data?.status || "no_schedule",
    payrollStatus: payrollRes.data?.status || "not_started",
    lastAgentRun: agentRes.data || null,
    onProbation,
  });
}
