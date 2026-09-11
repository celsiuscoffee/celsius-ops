import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: hr_* tables are RLS deny-all, so the anon client returns
// nothing (payslips were invisible to ALL staff since the lockdown). We scope to
// the caller's own user_id below, which is the security boundary here.
import { supabaseAdmin } from "@/lib/supabase";
import { getMYTToday } from "@/lib/hr/constants";
import { isPayslipReleased } from "@/lib/hr/payslip-release";

export const dynamic = "force-dynamic";

// GET: my payslips (monthly full-timer runs AND weekly part-timer runs).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Confirmed/paid payroll items for THIS user only. Order by confirmed_at so
  // both cycles interleave correctly — weekly runs have null period_year/month,
  // so month/year ordering would sink them below every monthly payslip.
  //
  // EXCLUDE opening_balance runs: the BrioHR migration loaded a single
  // Jan-to-Jun 2026 YTD aggregate (cycle_type 'opening_balance') purely to seed
  // PCB carry-forward. It is NOT a payslip, and surfacing it here showed staff a
  // 6-month total mislabelled as one month. Only real monthly/weekly payroll
  // runs are payslips.
  const { data: items, error } = await supabaseAdmin
    .from("hr_payroll_items")
    .select("*, hr_payroll_runs!inner(status, cycle_type, period_month, period_year, period_start, period_end, confirmed_at)")
    .eq("user_id", session.id)
    .in("hr_payroll_runs.status", ["confirmed", "paid"])
    .neq("hr_payroll_runs.cycle_type", "opening_balance")
    .order("confirmed_at", { ascending: false, foreignTable: "hr_payroll_runs" })
    .limit(24);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Release gate: HR can hold MONTHLY payslips until a fixed day of the
  // following month (hr_company_settings.payslip_release_day). Unset = today's
  // behaviour, visible the moment the run is confirmed. Weekly PT slips are
  // never gated — see lib/hr/payslip-release.ts.
  const { data: settings } = await supabaseAdmin
    .from("hr_company_settings")
    .select("payslip_release_day")
    .limit(1)
    .maybeSingle();
  const releaseDay = (settings as { payslip_release_day?: number | null } | null)?.payslip_release_day ?? null;
  const todayMyt = getMYTToday();

  // Add the flat aliases the native Payslip type reads
  // (apps/staff-native/lib/hr/api.ts): base_salary, overtime_pay (sum of
  // all OT tiers), pcb, and allowances as a NUMBER (sum of the
  // `allowances` jsonb amounts). Raw columns + the joined run are kept.
  const rows = ((items || []) as Array<Record<string, unknown>>).filter((row) => {
    const run = row.hr_payroll_runs as
      | { cycle_type?: string | null; period_month?: number | null; period_year?: number | null }
      | null;
    return !run || isPayslipReleased(run, releaseDay, todayMyt);
  });
  const payslips = rows.map((row) => {
    const num = (v: unknown) => Number(v ?? 0) || 0;
    const overtime_pay =
      num(row.ot_1x_amount) +
      num(row.ot_1_5x_amount) +
      num(row.ot_2x_amount) +
      num(row.ot_3x_amount);
    const alloc = (row.allowances ?? null) as
      | Record<string, { amount?: number } | null>
      | null;
    const allowancesTotal = alloc
      ? Object.values(alloc).reduce((sum, a) => sum + num(a?.amount), 0)
      : 0;
    return {
      ...row,
      base_salary: num(row.basic_salary),
      overtime_pay,
      pcb: num(row.pcb_tax),
      allowances: allowancesTotal,
    };
  });

  return NextResponse.json({ payslips });
}
