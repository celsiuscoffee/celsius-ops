import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// Last N months of confirmed/paid payroll snapshots for this employee.
// Surfaces attendance + performance allowance earned, plus review penalty,
// so the Performance tab can show a real history instead of just the current
// month's snapshot.
//
// GET /api/hr/employees/[id]/performance-history?months=6
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Data-scope: a MANAGER may only see their own direct/indirect reports.
  // Without this any manager could pull any employee's payroll history.
  const visible = await resolveVisibleUserIds(session);
  if (visible !== null && !visible.includes(id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Comp figures (basic salary, gross, net) are OWNER/ADMIN only — a line
  // manager sees the performance signals (allowances earned, review penalty)
  // but not pay. Matches the field-stripping on the employees list endpoint.
  const canSeeComp = session.role === "OWNER" || session.role === "ADMIN";

  const months = Math.min(24, Math.max(1, Number(new URL(req.url).searchParams.get("months") || 6)));

  const { data: items } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select(
      "user_id, basic_salary, total_gross, net_pay, allowances, other_deductions, " +
      "hr_payroll_runs!inner(period_year, period_month, status, cycle_type)",
    )
    .eq("user_id", id)
    .eq("hr_payroll_runs.cycle_type", "monthly")
    .in("hr_payroll_runs.status", ["confirmed", "paid"])
    .order("period_year", { ascending: false, foreignTable: "hr_payroll_runs" })
    .order("period_month", { ascending: false, foreignTable: "hr_payroll_runs" })
    .limit(months);

  type Item = {
    user_id: string;
    basic_salary: number | string;
    total_gross: number | string;
    net_pay: number | string;
    allowances: Record<string, { amount?: number }> | null;
    other_deductions: Record<string, unknown> | null;
    hr_payroll_runs: { period_year: number; period_month: number; status: string };
  };

  const history = ((items || []) as unknown as Item[]).map((it) => {
    const a = it.allowances || {};
    const o = it.other_deductions || {};
    const attendance = Number(a.attendance?.amount || 0);
    const performance = Number(a.performance?.amount || 0);
    const reviewPenalty =
      typeof o.review_penalty === "number"
        ? o.review_penalty
        : Number((o.review_penalty as { amount?: number })?.amount || 0);
    const unpaidLeave = Number(o.unpaid_leave || 0);
    return {
      period_year: it.hr_payroll_runs.period_year,
      period_month: it.hr_payroll_runs.period_month,
      status: it.hr_payroll_runs.status,
      // Comp fields only for OWNER/ADMIN; omitted entirely for MANAGER.
      ...(canSeeComp
        ? { basic_salary: Number(it.basic_salary), gross: Number(it.total_gross), net: Number(it.net_pay) }
        : {}),
      attendance_allowance: attendance,
      performance_allowance: performance,
      review_penalty: reviewPenalty,
      unpaid_leave: unpaidLeave,
      total_allowances_earned: attendance + performance,
    };
  });

  return NextResponse.json({ history, canSeeComp });
}
