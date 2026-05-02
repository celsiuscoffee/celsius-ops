import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// HR analytics dashboard data: headcount, turnover, attendance health,
// payroll cost trends. All read-side, single endpoint so the page can render
// in one round trip.
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const ytdStart = `${today.getFullYear()}-01-01`;
  const last90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const [
    profilesRes, recentLogsRes, recentRunsRes,
    pendingLeaveRes, pendingSwapsRes, pendingDiscRes, complianceRes,
    onboardingTplRes, onboardingProgRes,
  ] = await Promise.all([
    hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("user_id, employment_type, basic_salary, join_date, end_date, resigned_at, probation_end_date"),
    hrSupabaseAdmin
      .from("hr_attendance_logs")
      .select("user_id, clock_in, ai_status, final_status, regular_hours, overtime_hours")
      .gte("clock_in", last90),
    hrSupabaseAdmin
      .from("hr_payroll_runs")
      .select("period_year, period_month, status, total_gross, total_net, total_employer_cost, cycle_type")
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false })
      .limit(12),
    hrSupabaseAdmin
      .from("hr_leave_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending"]),
    hrSupabaseAdmin
      .from("hr_shift_swap_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "consented"]),
    hrSupabaseAdmin
      .from("hr_disciplinary_actions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    hrSupabaseAdmin
      .from("hr_compliance_events")
      .select("id, due_date, status, title, category")
      .neq("status", "done")
      .lte("due_date", new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
      .order("due_date"),
    hrSupabaseAdmin
      .from("hr_onboarding_templates")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    hrSupabaseAdmin
      .from("hr_onboarding_progress")
      .select("user_id, completed_at"),
  ]);

  const profiles = profilesRes.data || [];
  const userIds = profiles.map((p: { user_id: string }) => p.user_id);
  const userStatuses = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, status: true },
      })
    : [];
  const activeUserIds = new Set(userStatuses.filter((u) => u.status === "ACTIVE").map((u) => u.id));

  // Headcount split
  type Profile = {
    user_id: string;
    employment_type: string;
    basic_salary: number | string | null;
    join_date: string | null;
    end_date: string | null;
    resigned_at: string | null;
    probation_end_date: string | null;
  };
  const todayStr = today.toISOString().slice(0, 10);
  const active = (profiles as Profile[]).filter((p) => {
    if (!activeUserIds.has(p.user_id)) return false;
    const lastDay = p.end_date || p.resigned_at;
    return !lastDay || lastDay >= todayStr;
  });
  const byType: Record<string, number> = {};
  for (const p of active) byType[p.employment_type || "unset"] = (byType[p.employment_type || "unset"] || 0) + 1;

  // YTD turnover (resignations this year)
  const yearStart = `${today.getFullYear()}-01-01`;
  const ytdResigners = (profiles as Profile[]).filter((p) => {
    const last = p.end_date || p.resigned_at;
    return last && last >= yearStart && last <= todayStr;
  }).length;
  const turnoverPct = active.length > 0
    ? Math.round((ytdResigners / (active.length + ytdResigners)) * 1000) / 10
    : 0;

  // In-probation cohort (probation_end_date in future, or join_date within 90 days)
  const probationCohort = active.filter((p) => {
    if (p.probation_end_date) return p.probation_end_date >= todayStr;
    if (!p.join_date) return false;
    const joinTs = Date.parse(p.join_date);
    return Date.now() - joinTs < 90 * 86400000;
  }).length;

  // Attendance signals (last 90 days)
  type Log = {
    user_id: string;
    ai_status: string | null;
    final_status: string | null;
    regular_hours: number | string | null;
    overtime_hours: number | string | null;
  };
  const logs = (recentLogsRes.data || []) as Log[];
  let approvedCount = 0, flaggedCount = 0, totalRegHours = 0, totalOTHours = 0;
  for (const l of logs) {
    const isApproved = l.final_status === "approved" || l.final_status === "adjusted"
      || (l.ai_status === "approved" && !l.final_status);
    if (isApproved) approvedCount++;
    else if (l.final_status === "flagged" || l.ai_status === "flagged") flaggedCount++;
    totalRegHours += Number(l.regular_hours || 0);
    totalOTHours += Number(l.overtime_hours || 0);
  }

  // Payroll cost trend (last 12 runs)
  const runs = (recentRunsRes.data || []) as Array<{
    period_year: number; period_month: number; cycle_type: string;
    total_gross: number | string; total_net: number | string; total_employer_cost: number | string;
  }>;
  const monthlyCost = runs
    .filter((r) => r.cycle_type === "monthly")
    .map((r) => ({
      period: `${r.period_year}-${String(r.period_month).padStart(2, "0")}`,
      gross: Number(r.total_gross || 0),
      net: Number(r.total_net || 0),
      employer_cost: Number(r.total_employer_cost || 0),
      total_outflow: Number(r.total_net || 0) + Number(r.total_employer_cost || 0),
    }))
    .reverse();

  return NextResponse.json({
    headcount: {
      active: active.length,
      by_type: byType,
      in_probation: probationCohort,
    },
    turnover: {
      ytd_resigners: ytdResigners,
      ytd_pct: turnoverPct,
    },
    attendance_90d: {
      log_count: logs.length,
      approved: approvedCount,
      flagged_or_pending: logs.length - approvedCount,
      flagged_only: flaggedCount,
      total_regular_hours: Math.round(totalRegHours),
      total_ot_hours: Math.round(totalOTHours),
    },
    payroll_trend_monthly: monthlyCost,
    pending_actions: {
      leave: pendingLeaveRes.count ?? 0,
      shift_swaps: pendingSwapsRes.count ?? 0,
      disciplinary_active: pendingDiscRes.count ?? 0,
    },
    onboarding: (() => {
      // Compute %-complete for active staff hired in the last 90 days.
      const totalTemplates = onboardingTplRes.count ?? 0;
      type Prog = { user_id: string; completed_at: string | null };
      const completedByUser = new Map<string, number>();
      for (const p of (onboardingProgRes.data || []) as Prog[]) {
        if (p.completed_at) completedByUser.set(p.user_id, (completedByUser.get(p.user_id) || 0) + 1);
      }
      const newJoinersThreshold = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const newJoiners = (profiles as Profile[]).filter(
        (p) => activeUserIds.has(p.user_id) && p.join_date && p.join_date >= newJoinersThreshold,
      );
      const incompletes = newJoiners.filter((p) => (completedByUser.get(p.user_id) || 0) < totalTemplates);
      return {
        new_joiners_90d: newJoiners.length,
        incomplete_count: incompletes.length,
        total_template_tasks: totalTemplates,
        incomplete_user_ids: incompletes.map((p) => p.user_id).slice(0, 20),
      };
    })(),
    compliance_30d: complianceRes.data || [],
    generated_at: new Date().toISOString(),
    ytd_start: ytdStart,
  });
}
