import { hrSupabaseAdmin } from "../supabase";
import { breakHoursFor, mytDateString } from "../hours";

type WeeklyPayrollResult = {
  payrollRunId: string;
  employeeCount: number;
  totalGross: number;
  notes: string[];
};

/**
 * Weekly Payroll Calculator (Part-Timers) — CLOCK-BASED, FLAT HOURLY.
 *
 * Part-timers are paid for the hours they actually CLOCK on the Celsius staff app
 * (clock-in to clock-out), at their flat hourly_rate. No OT premium for the PT
 * cohort — every clocked working hour pays the same rate. The unpaid break is
 * excluded using the same rule the attendance engine applies (part-timer: 30 min
 * if the shift is over 4 hours), so pay reflects worked time, not gross clock time.
 *
 * Pay basis per PT for the Mon–Sun (MYT) week:
 *   workedHours(log) = totalHours(log) − break        (totalHours = clock_out − clock_in)
 *   gross           = Σ workedHours × hourly_rate
 * Only CLOSED logs count (need a clock-out to have hours); REJECTED logs are
 * excluded (a manager marked them bogus). Open/still-clocked-in logs are skipped.
 *
 * No EPF/SOCSO/EIS/PCB at this layer — the Celsius part-timer cohort is below
 * thresholds. If you onboard a senior part-timer above the threshold, add
 * statutory math here mirroring the monthly calculator.
 */
export async function calculateWeeklyPayroll(
  weekStart: string, // ISO date (YYYY-MM-DD), must be a Monday
): Promise<WeeklyPayrollResult> {
  const notes: string[] = [];

  const start = new Date(`${weekStart}T00:00:00.000Z`);
  if (start.getUTCDay() !== 1) {
    throw new Error("week_start must be a Monday (YYYY-MM-DD)");
  }
  const periodEnd = new Date(start);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 6);
  const periodStartStr = weekStart;
  const periodEndStr = periodEnd.toISOString().slice(0, 10);
  // MYT week window: Monday 00:00 to Sunday 23:59:59 Malaysia time (not UTC), so a
  // late-evening or pre-8am clock-in lands in the right week.
  const weekStartIso = `${periodStartStr}T00:00:00+08:00`;
  const weekEndIso = `${periodEndStr}T23:59:59+08:00`;

  // 1. Part-timer profiles.
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, hourly_rate, end_date, resigned_at")
    .eq("employment_type", "part_time");

  if (!profiles || profiles.length === 0) {
    throw new Error("No part-time employees found.");
  }
  const ptIds = profiles.map((p: { user_id: string }) => p.user_id);

  // 2. Clocked attendance for those PTs in the MYT week. Closed logs only.
  type Log = { user_id: string; clock_in: string; clock_out: string | null; total_hours: number | string | null; final_status: string | null };
  const { data: logsRaw } = ptIds.length
    ? await hrSupabaseAdmin
        .from("hr_attendance_logs")
        .select("user_id, clock_in, clock_out, total_hours, final_status")
        .in("user_id", ptIds)
        .gte("clock_in", weekStartIso)
        .lte("clock_in", weekEndIso)
        .not("clock_out", "is", null)
    : { data: [] as Log[] };

  const logsByUser = new Map<string, Log[]>();
  let paidLogCount = 0;
  for (const l of (logsRaw || []) as Log[]) {
    if (l.final_status === "rejected") continue; // bogus entry — don't pay
    const list = logsByUser.get(l.user_id) || [];
    list.push(l);
    logsByUser.set(l.user_id, list);
    paidLogCount++;
  }

  // 3. Wipe existing draft/computed weekly run for this period.
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

  // 4. Per-employee compute (flat hourly on worked = clocked − break).
  let totalGross = 0;
  const payrollItems: Record<string, unknown>[] = [];
  let staffWithNoClockins = 0;

  for (const profile of profiles) {
    // Resigned before this cycle → don't include. Use end_date (last working day).
    const resignDate = profile.end_date || profile.resigned_at || null;
    if (resignDate && resignDate < periodStartStr) {
      continue;
    }

    const userLogs = logsByUser.get(profile.user_id) || [];
    if (userLogs.length === 0) {
      staffWithNoClockins++;
      continue; // No clock-ins this week — no payroll line.
    }

    const hourlyRate = Number(profile.hourly_rate) || 0;
    if (hourlyRate <= 0) {
      notes.push(`Skipped ${profile.user_id.slice(0, 8)}: no hourly_rate set`);
      continue;
    }

    let workedHours = 0;
    const logDetails: Array<{ date: string; hours: number; start: string; end: string }> = [];
    for (const l of userLogs) {
      const clockIn = new Date(l.clock_in);
      const clockOut = new Date(l.clock_out as string);
      const totalH = l.total_hours != null
        ? Number(l.total_hours)
        : Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000);
      const worked = Math.max(0, Math.round((totalH - breakHoursFor("part_time", totalH)) * 100) / 100);
      workedHours += worked;
      logDetails.push({ date: mytDateString(l.clock_in), hours: worked, start: clockIn.toISOString(), end: clockOut.toISOString() });
    }
    workedHours = Math.round(workedHours * 100) / 100;
    const gross = Math.round(workedHours * hourlyRate * 100) / 100;
    totalGross += gross;

    payrollItems.push({
      payroll_run_id: run.id,
      user_id: profile.user_id,
      basic_salary: gross,
      total_regular_hours: workedHours,
      total_ot_hours: 0,
      ot_1x_amount: 0,
      ot_1_5x_amount: 0,
      ot_2x_amount: 0,
      ot_3x_amount: 0,
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
        cycle: "weekly",
        basis: "clocked",
        worked_hours: workedHours,
        attendance_records: logDetails.length,
        shifts: logDetails,
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
      ai_notes: `${payrollItems.length} part-timers paid for ${paidLogCount} clocked shifts. Gross: RM ${totalGross.toLocaleString()}`,
    })
    .eq("id", run.id);

  notes.push(
    `${payrollItems.length} part-timer${payrollItems.length === 1 ? "" : "s"} processed for ${periodStartStr} to ${periodEndStr} ` +
    `(${paidLogCount} clocked shifts, RM ${totalGross.toLocaleString()} gross).`,
  );
  if (staffWithNoClockins > 0) {
    notes.push(
      `${staffWithNoClockins} part-timer${staffWithNoClockins === 1 ? "" : "s"} had no clock-ins this week — no payroll line created.`,
    );
  }

  return {
    payrollRunId: run.id,
    employeeCount: payrollItems.length,
    totalGross,
    notes,
  };
}
