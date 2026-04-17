import { hrSupabaseAdmin } from "../supabase";
import { OT_RATES } from "../constants";

type WeeklyPayrollResult = {
  payrollRunId: string;
  employeeCount: number;
  totalGross: number;
  notes: string[];
};

/**
 * Weekly Payroll Calculator (Part-Timers)
 *
 * Computes weekly payroll for employees with employment_type = 'part_time'.
 * Period is Mon–Sun; gross = regular_hours × hourly_rate + OT.
 * No EPF/SOCSO/EIS/PCB applied (PTs below threshold — can be layered in later).
 */
export async function calculateWeeklyPayroll(
  weekStart: string, // ISO date (YYYY-MM-DD), must be a Monday
): Promise<WeeklyPayrollResult> {
  const notes: string[] = [];

  const start = new Date(`${weekStart}T00:00:00.000Z`);
  if (start.getUTCDay() !== 1) {
    throw new Error("week_start must be a Monday (YYYY-MM-DD)");
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7); // exclusive
  const periodEnd = new Date(end);
  periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
  const periodStartStr = weekStart;
  const periodEndStr = periodEnd.toISOString().slice(0, 10);

  // 1. Get part-timer profiles
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("*")
    .eq("employment_type", "part_time");

  if (!profiles || profiles.length === 0) {
    throw new Error("No part-time employees found.");
  }

  // 2. Approved attendance for this week
  const { data: attendance } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("*")
    .gte("clock_in", start.toISOString())
    .lt("clock_in", end.toISOString())
    .in("ai_status", ["approved", "reviewed"])
    .or("final_status.eq.approved,final_status.eq.adjusted");

  const attendanceByUser = new Map<string, typeof attendance>();
  (attendance || []).forEach((a: { user_id: string }) => {
    const list = attendanceByUser.get(a.user_id) || [];
    list.push(a);
    attendanceByUser.set(a.user_id, list);
  });

  // 3. Delete existing draft/computed run for this week
  await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .delete()
    .eq("cycle_type", "weekly")
    .eq("period_start", periodStartStr)
    .in("status", ["draft", "ai_computed"]);

  const { data: run, error: runError } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .insert({
      cycle_type: "weekly",
      period_start: periodStartStr,
      period_end: periodEndStr,
      status: "ai_computed",
      ai_computed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (runError) throw new Error(`Failed to create payroll run: ${runError.message}`);

  // 4. Per-employee computation
  let totalGross = 0;
  const payrollItems: Record<string, unknown>[] = [];

  for (const profile of profiles) {
    const hourlyRate = Number(profile.hourly_rate) || 0;
    if (hourlyRate <= 0) {
      notes.push(`Skipped ${profile.user_id.slice(0, 8)}: no hourly_rate set`);
      continue;
    }

    const userAttendance = attendanceByUser.get(profile.user_id) || [];
    let totalRegularHours = 0;
    let totalOtHours = 0;
    let ot1xAmount = 0;
    let ot15xAmount = 0;
    let ot2xAmount = 0;
    let ot3xAmount = 0;

    for (const a of userAttendance) {
      totalRegularHours += Number(a.regular_hours) || 0;
      const otHours = Number(a.overtime_hours) || 0;
      totalOtHours += otHours;

      if (otHours > 0) {
        const otType = a.overtime_type || "ot_1_5x";
        const amount = otHours * hourlyRate;
        if (otType === "rest_day_1x" || otType === "ot_1x") ot1xAmount += amount * 1;
        else if (otType === "ot_1_5x") ot15xAmount += amount * OT_RATES.normal;
        else if (otType === "ot_2x") ot2xAmount += amount * OT_RATES.rest_day;
        else if (otType === "ot_3x" || otType === "ph_2x") ot3xAmount += amount * OT_RATES.public_holiday_ot;
      }
    }

    const basePay = totalRegularHours * hourlyRate;
    const totalOT = Math.round((ot1xAmount + ot15xAmount + ot2xAmount + ot3xAmount) * 100) / 100;
    const gross = Math.round((basePay + totalOT) * 100) / 100;

    totalGross += gross;

    payrollItems.push({
      payroll_run_id: run.id,
      user_id: profile.user_id,
      basic_salary: basePay,
      total_regular_hours: Math.round(totalRegularHours * 100) / 100,
      total_ot_hours: Math.round(totalOtHours * 100) / 100,
      ot_1x_amount: Math.round(ot1xAmount * 100) / 100,
      ot_1_5x_amount: Math.round(ot15xAmount * 100) / 100,
      ot_2x_amount: Math.round(ot2xAmount * 100) / 100,
      ot_3x_amount: Math.round(ot3xAmount * 100) / 100,
      allowances: {},
      total_gross: gross,
      epf_employee: 0,
      socso_employee: 0,
      eis_employee: 0,
      pcb_tax: 0,
      other_deductions: {},
      total_deductions: 0,
      net_pay: gross,
      epf_employer: 0,
      socso_employer: 0,
      eis_employer: 0,
      computation_details: {
        hourly_rate: hourlyRate,
        employment_type: "part_time",
        attendance_records: userAttendance.length,
        cycle: "weekly",
      },
    });
  }

  if (payrollItems.length > 0) {
    const { error: itemsError } = await hrSupabaseAdmin
      .from("hr_payroll_items")
      .insert(payrollItems);
    if (itemsError) throw new Error(`Failed to save payroll items: ${itemsError.message}`);
  }

  totalGross = Math.round(totalGross * 100) / 100;

  await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .update({
      total_gross: totalGross,
      total_deductions: 0,
      total_net: totalGross,
      total_employer_cost: 0,
      ai_notes: `${payrollItems.length} part-timers, ${(attendance || []).length} shifts. Gross: RM ${totalGross.toLocaleString()}`,
    })
    .eq("id", run.id);

  notes.push(`${payrollItems.length} part-timers processed for week ${periodStartStr} to ${periodEndStr}`);
  notes.push(`Total gross: RM ${totalGross.toLocaleString()}`);

  return {
    payrollRunId: run.id,
    employeeCount: payrollItems.length,
    totalGross,
    notes,
  };
}
