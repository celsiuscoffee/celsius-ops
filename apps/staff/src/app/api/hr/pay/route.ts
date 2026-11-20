import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role: hr_* tables are RLS deny-all. Every query below is scoped to
// session.id, which is the security boundary here.
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { getMYTToday } from "@/lib/hr/constants";
import { computeAllowances } from "@/lib/hr/allowances";
import { isPayslipReleased, payslipReleaseDate } from "@/lib/hr/payslip-release";
import {
  addDays,
  monthApprovedOt,
  monthBefore,
  payslipLabel,
  runStatus,
  soFarEstimate,
  summarizeWeek,
  waitingOt,
  weekStartOf,
  type PayItemRow,
  type PayLog,
  type PayResponse,
  type PendingOt,
} from "@/lib/hr/pay-summary";

export const dynamic = "force-dynamic";

// GET: the Pay tab (owner, 20 Nov 2026). READ-ONLY, the caller's own pay only.
//
// Everything here is payroll's own data, never a second formula
// (lib/hr/pay-summary.ts says which rule comes from where):
//   - full-timers: basic salary on the profile, the allowance engine's total so
//     far (the same number the Shifts hub card shows), fixed additions from
//     hr_employee_recurring_items, approved OT hours from the logs payroll
//     reads, OT still with a manager from hr_overtime_requests, and last
//     month's run status;
//   - part-timers: this week's and last week's shifts, clocked hours, the
//     manager sign-off count (the gate before the weekly run), and that week's
//     run status;
//   - everyone: the latest released payslip (same gate as /api/hr/payslips).
// Overtime is in hours only: payroll prices it at month end.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = getMYTToday();
  const ym = today.slice(0, 7);
  const [year, month] = ym.split("-").map(Number);
  const thisWeek = weekStartOf(today);
  const lastWeek = addDays(thisWeek, -7);
  const monthStart = `${ym}-01`;
  const monthEnd = addDays(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`, -1);
  // Read from whichever starts first: the month (full-timers) or last week (part-timers).
  const since = lastWeek < monthStart ? lastWeek : monthStart;

  const [profileRes, logsRes, pendingRes, approvedRes, itemsRes, settingsRes] = await Promise.all([
    supabase
      .from("hr_employee_profiles")
      .select("employment_type, basic_salary, confirmed_at")
      .eq("user_id", session.id)
      .maybeSingle(),
    supabase
      .from("hr_attendance_logs")
      .select("clock_in, clock_out, total_hours, overtime_hours, ai_status, final_status, reviewed_by, clock_in_method")
      .eq("user_id", session.id)
      .gte("clock_in", `${since}T00:00:00+08:00`)
      .order("clock_in", { ascending: true })
      .limit(500),
    supabase
      .from("hr_overtime_requests")
      .select("date, hours_requested")
      .eq("user_id", session.id)
      .eq("status", "pending")
      .gte("date", since),
    supabase
      .from("hr_overtime_requests")
      .select("date, hours_approved")
      .eq("user_id", session.id)
      .in("status", ["approved", "partial"])
      .gte("date", since),
    // This person's payroll lines with their runs (a few dozen a year), sorted
    // below by period. `*` on the run so a payday column is read when the run
    // carries one (the monthly calculator does not set one today).
    supabase
      .from("hr_payroll_items")
      .select("id, net_pay, hr_payroll_runs!inner(*)")
      .eq("user_id", session.id)
      .neq("hr_payroll_runs.cycle_type", "opening_balance")
      .limit(300),
    supabase.from("hr_company_settings").select("payslip_release_day").limit(1).maybeSingle(),
  ]);
  const failed = profileRes.error ?? logsRes.error ?? pendingRes.error ?? approvedRes.error ?? itemsRes.error;
  if (failed) return NextResponse.json({ error: failed.message }, { status: 500 });
  if (!profileRes.data) return NextResponse.json({ error: "No pay details on file yet. Ask your manager." }, { status: 404 });

  const profile = profileRes.data as { employment_type: string | null; basic_salary: number | string | null; confirmed_at: string | null };
  const logs = (logsRes.data ?? []) as PayLog[];
  const pending = (pendingRes.data ?? []) as PendingOt[];
  const approvedOt = ((approvedRes.data ?? []) as { date: string; hours_approved: number | null }[]).map((o) => ({ date: o.date, hours: o.hours_approved }));
  const releaseDay = (settingsRes.data as { payslip_release_day?: number | null } | null)?.payslip_release_day ?? null;

  const items: PayItemRow[] = ((itemsRes.data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const run = (row.hr_payroll_runs ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      net_pay: row.net_pay as number | null,
      run: {
        status: (run.status as string | null) ?? null,
        cycle_type: (run.cycle_type as string | null) ?? null,
        period_month: (run.period_month as number | null) ?? null,
        period_year: (run.period_year as number | null) ?? null,
        period_start: (run.period_start as string | null) ?? null,
        period_end: (run.period_end as string | null) ?? null,
        payday: typeof run.payday === "string" ? run.payday.slice(0, 10) : null,
      },
    };
  });

  // Latest payslip: confirmed or paid, past the release gate (as /api/hr/payslips).
  const latest = latestReleased(items, releaseDay, today);
  const latestPayslip: PayResponse["latestPayslip"] = latest
    ? { id: latest.id, netPay: Math.round((Number(latest.net_pay) || 0) * 100) / 100, ...payslipLabel(latest.run) }
    : null;

  // Payroll's split: the monthly run is full-timers only; everyone else is
  // signed off and paid by the week (payroll-calculator.ts skips the rest).
  const monthlyCycle = profile.employment_type === "full_time";
  const body: PayResponse = { today, cycle: monthlyCycle ? "monthly" : "weekly", monthly: null, weekly: null, lastMonth: null, latestPayslip };

  if (monthlyCycle) {
    const [additions, breakdown] = await Promise.all([
      fixedAdditions(session.id, monthStart, monthEnd),
      // The allowance engine's month so far; a failure leaves it out, never the pay.
      computeAllowances(session.id, year, month).catch((e: unknown) => {
        console.error("[pay] allowance failed:", (e as Error).message);
        return null;
      }),
    ]);

    // Probation: scored, not paid, until confirmed (payroll-calculator; probation.ts isOnProbation).
    const onProbation = !profile.confirmed_at || profile.confirmed_at.slice(0, 10) > monthEnd;
    const allowance: NonNullable<PayResponse["monthly"]>["allowance"] = !breakdown
      ? { state: "unavailable" }
      : !breakdown.eligible
        ? { state: "not_eligible" }
        : onProbation
          ? { state: "probation", earned: breakdown.totalEarned, max: breakdown.totalMax }
          : { state: "counted", earned: breakdown.totalEarned, max: breakdown.totalMax, daysRemaining: breakdown.period.daysRemaining };
    const basic = profile.basic_salary == null ? null : Math.round((Number(profile.basic_salary) || 0) * 100) / 100;
    const waiting = waitingOt(pending.filter((p) => p.date.slice(0, 7) === ym));
    const thisRun = items.find((i) => isMonthlyRun(i, year, month));

    body.monthly = {
      month: ym,
      basicSalary: basic,
      additions,
      allowance,
      soFar: soFarEstimate(basic, allowance.state === "counted" ? allowance.earned : null, additions),
      overtime: {
        approvedHours: monthApprovedOt(logs, ym),
        waitingHours: waiting.reduce((t, w) => t + w.hours, 0),
        waiting,
      },
      payday: thisRun?.run.payday ?? null,
    };

    const prev = monthBefore(ym);
    const [py, pm] = prev.split("-").map(Number);
    const prevRun = items.find((i) => isMonthlyRun(i, py, pm) && runStatus(i.run.status));
    const prevStatus = prevRun ? runStatus(prevRun.run.status) : null;
    body.lastMonth = {
      month: prev,
      status: prevStatus ?? "not_started",
      payday: prevRun?.run.payday ?? null,
      opensOn:
        prevRun && prevStatus !== "preparing" && !isPayslipReleased(prevRun.run, releaseDay, today)
          ? payslipReleaseDate(prevRun.run, releaseDay)
          : null,
    };
  } else {
    const lastRun = items.find((i) => i.run.cycle_type === "weekly" && i.run.period_start === lastWeek && runStatus(i.run.status));
    body.weekly = {
      thisWeek: summarizeWeek(thisWeek, logs, approvedOt, pending),
      lastWeek: {
        ...summarizeWeek(lastWeek, logs, approvedOt, pending),
        run: lastRun ? { status: runStatus(lastRun.run.status)!, payday: lastRun.run.payday ?? null } : null,
      },
    };
  }

  return NextResponse.json(body);
}

const isMonthlyRun = (i: PayItemRow, y: number, m: number) =>
  i.run.cycle_type !== "weekly" && i.run.period_year === y && i.run.period_month === m;

/** Newest confirmed/paid line past the payslip release gate. */
function latestReleased(items: PayItemRow[], releaseDay: number | null, today: string): PayItemRow | null {
  // Monthly runs carry no period_end; date them by their month's last day.
  const key = (i: PayItemRow) =>
    i.run.period_end ??
    (i.run.period_year && i.run.period_month ? `${i.run.period_year}-${String(i.run.period_month).padStart(2, "0")}-31` : "");
  return (
    items
      .filter((i) => (i.run.status === "confirmed" || i.run.status === "paid") && isPayslipReleased(i.run, releaseDay, today))
      .sort((a, b) => key(b).localeCompare(key(a)))[0] ?? null
  );
}

/**
 * Fixed additions on the record, as payroll adds them (payroll-calculator 3b):
 * non-deduction recurring items active in the month, named from the pay items
 * catalogue. A failure leaves them out, never the pay.
 */
async function fixedAdditions(userId: string, monthStart: string, monthEnd: string): Promise<{ label: string; amount: number }[]> {
  try {
    const { data, error } = await supabase
      .from("hr_employee_recurring_items")
      .select("catalog_code, kind, amount")
      .eq("user_id", userId)
      .lte("effective_date", monthEnd)
      .or(`end_date.is.null,end_date.gte.${monthStart}`);
    if (error || !data?.length) return [];
    const rows = (data as { catalog_code: string; kind: string; amount: number | string | null }[]).filter((r) => r.kind !== "deduction");
    if (!rows.length) return [];
    const { data: cats } = await supabase
      .from("hr_payroll_item_catalog")
      .select("code, name")
      .in("code", [...new Set(rows.map((r) => r.catalog_code))]);
    const names = new Map(((cats ?? []) as { code: string; name: string }[]).map((c) => [c.code, c.name]));
    // Payroll skips an item whose code is not in the catalogue; so does this.
    return rows
      .filter((r) => names.has(r.catalog_code))
      .map((r) => ({ label: names.get(r.catalog_code)!, amount: Math.round((Number(r.amount) || 0) * 100) / 100 }))
      .filter((a) => a.amount > 0);
  } catch {
    return [];
  }
}
