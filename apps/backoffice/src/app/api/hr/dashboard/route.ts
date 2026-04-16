import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

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

  const [flaggedRes, leaveRes, scheduleRes, payrollRes, agentRes] = await Promise.all([
    // Flagged attendance count
    hrSupabaseAdmin
      .from("hr_attendance_logs")
      .select("id", { count: "exact", head: true })
      .eq("ai_status", "flagged")
      .match(outletFilter),

    // Escalated leave requests
    hrSupabaseAdmin
      .from("hr_leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "ai_escalated"),

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
  ]);

  return NextResponse.json({
    flaggedAttendance: flaggedRes.count || 0,
    escalatedLeave: leaveRes.count || 0,
    scheduleStatus: scheduleRes.data?.status || "no_schedule",
    payrollStatus: payrollRes.data?.status || "not_started",
    lastAgentRun: agentRes.data || null,
  });
}
