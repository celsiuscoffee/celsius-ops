import { hrSupabaseAdmin } from "../supabase";

type WeeklyPayrollResult = {
  payrollRunId: string;
  employeeCount: number;
  totalGross: number;
  notes: string[];
};

/**
 * Weekly Payroll Calculator (Part-Timers) — SCHEDULE-BASED.
 *
 * Per Celsius policy, part-timers are paid for the shifts they were SCHEDULED
 * for in a published roster, NOT for actual attendance. If a PT no-shows, that
 * is handled separately via review-penalties / not re-scheduling them. If they
 * clock OT beyond their scheduled shift, a manager adds it as an ad-hoc
 * adjustment line on the run.
 *
 * Pay basis: sum of (end_time − start_time − break_minutes) per shift_date in
 * the Mon–Sun period, across PUBLISHED schedules only. Multiplied by the
 * employee's hourly_rate.
 *
 * No EPF/SOCSO/EIS/PCB applied at this layer — the Celsius part-timer cohort
 * is below thresholds. If you onboard a senior part-timer above the threshold,
 * add statutory math here mirroring the monthly calculator.
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

  // 1. Part-timer profiles (only ones with hourly rate set are payable).
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, hourly_rate, end_date, resigned_at")
    .eq("employment_type", "part_time");

  if (!profiles || profiles.length === 0) {
    throw new Error("No part-time employees found.");
  }

  // 2. PUBLISHED schedules covering this week. Draft/unpublished schedules
  // are not paid — the roster has to be committed before staff get paid for it.
  const { data: schedules } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id, week_start, week_end, status")
    .eq("status", "published")
    .lte("week_start", periodEndStr)
    .gte("week_end", periodStartStr);
  const scheduleIds = (schedules || []).map((s: { id: string }) => s.id);

  // 3. Scheduled shifts for those schedules, falling on dates within the cycle.
  const { data: shifts } = scheduleIds.length
    ? await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id, shift_date, start_time, end_time, break_minutes")
        .in("schedule_id", scheduleIds)
        .gte("shift_date", periodStartStr)
        .lte("shift_date", periodEndStr)
    : { data: [] as Array<{
        user_id: string; shift_date: string; start_time: string;
        end_time: string; break_minutes: number | null;
      }> };

  type Shift = {
    user_id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    break_minutes: number | null;
  };
  const shiftsByUser = new Map<string, Shift[]>();
  for (const s of (shifts || []) as Shift[]) {
    const list = shiftsByUser.get(s.user_id) || [];
    list.push(s);
    shiftsByUser.set(s.user_id, list);
  }

  // 4. Wipe existing draft/computed weekly run for this period.
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

  // 5. Per-employee compute.
  let totalGross = 0;
  const payrollItems: Record<string, unknown>[] = [];
  let staffWithNoShifts = 0;

  for (const profile of profiles) {
    // Resigned before this cycle → don't include.
    // Use end_date (last working day) for payroll cutoff, not the letter-submission date.
    const resignDate = profile.end_date || profile.resigned_at || null;
    if (resignDate && resignDate < periodStartStr) {
      continue;
    }

    const hourlyRate = Number(profile.hourly_rate) || 0;
    if (hourlyRate <= 0) {
      notes.push(`Skipped ${profile.user_id.slice(0, 8)}: no hourly_rate set`);
      continue;
    }

    const userShifts = shiftsByUser.get(profile.user_id) || [];
    if (userShifts.length === 0) {
      staffWithNoShifts++;
      continue; // Don't insert empty rows for PTs not scheduled this week.
    }

    let totalHours = 0;
    const shiftDetails: Array<{ date: string; hours: number; start: string; end: string }> = [];
    for (const sh of userShifts) {
      const hours = computeShiftHours(sh.start_time, sh.end_time, sh.break_minutes ?? 0);
      totalHours += hours;
      shiftDetails.push({
        date: sh.shift_date,
        hours: Math.round(hours * 100) / 100,
        start: sh.start_time,
        end: sh.end_time,
      });
    }
    totalHours = Math.round(totalHours * 100) / 100;
    const gross = Math.round(totalHours * hourlyRate * 100) / 100;
    totalGross += gross;

    payrollItems.push({
      payroll_run_id: run.id,
      user_id: profile.user_id,
      basic_salary: gross,
      total_regular_hours: totalHours,
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
        basis: "scheduled",
        scheduled_hours: totalHours,
        shift_count: shiftDetails.length,
        shifts: shiftDetails,
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
      ai_notes: `${payrollItems.length} part-timers paid for ${(shifts || []).length} scheduled shifts. Gross: RM ${totalGross.toLocaleString()}`,
    })
    .eq("id", run.id);

  notes.push(
    `${payrollItems.length} part-timer${payrollItems.length === 1 ? "" : "s"} processed for ${periodStartStr} to ${periodEndStr} ` +
    `(${(shifts || []).length} scheduled shifts, RM ${totalGross.toLocaleString()} gross).`,
  );
  if (staffWithNoShifts > 0) {
    notes.push(
      `${staffWithNoShifts} part-timer${staffWithNoShifts === 1 ? "" : "s"} not scheduled this week — no payroll line created.`,
    );
  }
  if (scheduleIds.length === 0) {
    notes.push(
      `⚠ No published schedules found for this week. Publish the roster before computing payroll.`,
    );
  }

  return {
    payrollRunId: run.id,
    employeeCount: payrollItems.length,
    totalGross,
    notes,
  };
}

/**
 * Decimal hours between start_time and end_time, minus break_minutes.
 * Times are HH:MM:SS strings. Overnight shifts (end < start) wrap to next day.
 * Result is clamped at 0 so a malformed shift doesn't produce negative pay.
 */
function computeShiftHours(start: string, end: string, breakMinutes: number): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const startMin = toMinutes(start);
  let endMin = toMinutes(end);
  if (endMin <= startMin) endMin += 24 * 60; // overnight
  const grossMin = endMin - startMin - (breakMinutes || 0);
  return Math.max(0, grossMin / 60);
}
