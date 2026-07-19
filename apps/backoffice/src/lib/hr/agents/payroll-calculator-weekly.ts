import { hrSupabaseAdmin } from "../supabase";
import { breakHoursFor, mytDateString } from "../hours";
import { ptRateForDate } from "../pt-rate";

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
 * Pay basis per PT for the Mon–Sun (MYT) week (owner rules 2026-07-18/19):
 *   workedHours(log) = totalHours(log) − break        (totalHours = clock_out − clock_in)
 *   paidHours(log)   = min(workedHours, SCHEDULED net hours that day + approved OT)
 *                      — clocking in early / out late doesn't pay beyond the
 *                      roster unless an OT request was approved for that date;
 *                      a day with NO rostered shift and no OT pays 0 (add the
 *                      shift to the grid or approve OT to pay a cover).
 *   rate(log)        = weekday base Mon–Fri · hourly_rate_weekend Sat/Sun ·
 *                      2× the day's rate on a gazetted public holiday
 *   gross            = Σ paidHours(log) × rate(log)
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
    .select("user_id, hourly_rate, hourly_rate_weekend, end_date, resigned_at")
    .eq("employment_type", "part_time");

  // Public holidays inside the week — those days pay 2× (owner rule; the wage
  // sheet's RM18/RM20 entries).
  const { data: hols } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date")
    .gte("date", periodStartStr)
    .lte("date", periodEndStr);
  const holidaySet = new Set(((hols ?? []) as Array<{ date: string }>).map((h) => h.date));

  if (!profiles || profiles.length === 0) {
    throw new Error("No part-time employees found.");
  }
  const ptIds = profiles.map((p: { user_id: string }) => p.user_id);

  // Rostered net hours per (user, day) — the pay cap. Rest-day markers and
  // unconfirmed AI suggestions don't count as scheduled.
  const { data: rosterRows } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("user_id, shift_date, start_time, end_time, break_minutes, notes")
    .in("user_id", ptIds)
    .gte("shift_date", periodStartStr)
    .lte("shift_date", periodEndStr);
  const schedByUserDay = new Map<string, number>();
  for (const s of (rosterRows ?? []) as Array<{ user_id: string; shift_date: string; start_time: string; end_time: string; break_minutes: number | null; notes: string | null }>) {
    if (s.start_time?.slice(0, 5) === "00:00") continue;
    if (s.notes === "pt_suggestion") continue;
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    let mins = toMin(s.end_time) - toMin(s.start_time);
    if (mins < 0) mins += 24 * 60; // overnight closing
    const net = Math.max(0, mins / 60 - (s.break_minutes ?? 0) / 60);
    const key = `${s.user_id}:${s.shift_date}`;
    schedByUserDay.set(key, (schedByUserDay.get(key) ?? 0) + net);
  }

  // Approved OT per (user, day) — the only way past the schedule cap
  // (owner rule 2026-07-19: "capped on max scheduled hours, unless OT approves").
  const { data: otRows } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("user_id, date, hours_approved, status")
    .in("user_id", ptIds)
    .gte("date", periodStartStr)
    .lte("date", periodEndStr)
    .in("status", ["approved", "partial"]);
  const otByUserDay = new Map<string, number>();
  for (const o of (otRows ?? []) as Array<{ user_id: string; date: string; hours_approved: number | null }>) {
    const key = `${o.user_id}:${o.date}`;
    otByUserDay.set(key, (otByUserDay.get(key) ?? 0) + (Number(o.hours_approved) || 0));
  }

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

    // Day-aware pay: each log is priced at ITS date's rate (weekday base /
    // weekend rate / 2× on a public holiday) and CAPPED at that day's
    // rostered net hours + approved OT — clock drift doesn't inflate pay.
    let workedHours = 0;
    let paidHours = 0;
    let cappedHours = 0;
    let gross = 0;
    const logDetails: Array<{ date: string; hours: number; paid_hours: number; capped: boolean; rate: number; start: string; end: string }> = [];
    // A day's cap is consumed across multiple logs on the same day (split shifts).
    const capLeft = new Map<string, number>();
    for (const l of userLogs) {
      const clockIn = new Date(l.clock_in);
      const clockOut = new Date(l.clock_out as string);
      const totalH = l.total_hours != null
        ? Number(l.total_hours)
        : Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3600000);
      const worked = Math.max(0, Math.round((totalH - breakHoursFor("part_time", totalH)) * 100) / 100);
      const dateStr = mytDateString(l.clock_in);
      const dayKey = `${profile.user_id}:${dateStr}`;
      if (!capLeft.has(dayKey)) {
        capLeft.set(dayKey, (schedByUserDay.get(dayKey) ?? 0) + (otByUserDay.get(dayKey) ?? 0));
      }
      const paid = Math.round(Math.min(worked, capLeft.get(dayKey)!) * 100) / 100;
      capLeft.set(dayKey, Math.max(0, capLeft.get(dayKey)! - paid));
      const rate = ptRateForDate(profile, dateStr, holidaySet.has(dateStr));
      workedHours += worked;
      paidHours += paid;
      cappedHours += worked - paid;
      gross += paid * rate;
      logDetails.push({ date: dateStr, hours: worked, paid_hours: paid, capped: paid < worked, rate, start: clockIn.toISOString(), end: clockOut.toISOString() });
    }
    workedHours = Math.round(workedHours * 100) / 100;
    paidHours = Math.round(paidHours * 100) / 100;
    cappedHours = Math.round(cappedHours * 100) / 100;
    gross = Math.round(gross * 100) / 100;
    totalGross += gross;
    if (cappedHours > 0.01) {
      notes.push(
        `Capped ${cappedHours}h for ${profile.user_id.slice(0, 8)} (clocked ${workedHours}h vs schedule+OT ${paidHours}h) — add the shift to the roster or approve OT to pay the difference.`,
      );
    }

    payrollItems.push({
      payroll_run_id: run.id,
      user_id: profile.user_id,
      basic_salary: gross,
      total_regular_hours: paidHours,
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
        hourly_rate_weekend: profile.hourly_rate_weekend != null ? Number(profile.hourly_rate_weekend) : null,
        employment_type: "part_time",
        cycle: "weekly",
        basis: "clocked, day-aware rate (weekday/weekend/PH 2x), capped at schedule + approved OT",
        worked_hours: workedHours,
        paid_hours: paidHours,
        capped_hours: cappedHours,
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
