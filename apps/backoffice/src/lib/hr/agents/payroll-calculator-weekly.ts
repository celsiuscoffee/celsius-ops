import { hrSupabaseAdmin } from "../supabase";
import { mytDateString, mytInstant, paidWindowHours, pickShiftWindow, type ShiftWindow } from "../hours";
import { ptRateForDate } from "../pt-rate";
import { clipOverlappingLogs } from "../log-overlap";

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
 * Pay basis per PT for the Mon–Sun (MYT) week (owner rules 2026-07-18/19,
 * PAID WINDOW 2026-08-13):
 *   window(log)      = [ max(clock_in, rostered start) , min(clock_out, rostered end) ]
 *                      — only time INSIDE the rostered shift counts. Arriving
 *                      late or leaving early trims the window from that side;
 *                      clocking in early or staying late adds nothing by itself.
 *   paidHours(log)   = window − break + approved OT
 *   OT               = the tails OUTSIDE the window (early in / late out), each
 *                      floored to whole 30-min brackets, and paid only against
 *                      an approved hr_overtime_requests row for that date.
 *   no roster        = COVER shift: pay the clocked span − break, flagged for a
 *                      manager to confirm (it used to pay 0 and say nothing).
 *   rate(log)        = weekday base Mon–Fri · hourly_rate_weekend Sat/Sun ·
 *                      2× the day's rate on a gazetted public holiday
 *   gross            = Σ paidHours(log) × rate(log)
 *
 * The 30-min clock rounding this replaced (2026-08-07) is gone from the base
 * span: with the roster bounding the window, rounding only deducted twice, and
 * only from whoever clocked closest to their shift.
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
  // MYT week window: Monday 00:00 (inclusive) to NEXT Monday 00:00 (exclusive),
  // Malaysia time — not UTC, so a late-evening or pre-8am clock-in lands in the
  // right week. Exclusive upper bound: `lte …23:59:59` dropped a clock-in in
  // Sunday's final second into NEITHER week.
  const nextMonday = new Date(start);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const weekStartIso = `${periodStartStr}T00:00:00+08:00`;
  const weekEndExclusiveIso = `${nextMonday.toISOString().slice(0, 10)}T00:00:00+08:00`;

  // 1. Hourly-paid profiles: part-timers and interns. Interns share the PT pay
  // semantics everywhere else (OT_THRESHOLD_HOURS, breakHoursFor, the PT Hours
  // confirm screen lists them) — excluding them here made an intern
  // confirmable-but-unpaid, silently.
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, employment_type, hourly_rate, hourly_rate_weekend, end_date, resigned_at")
    .in("employment_type", ["part_time", "intern"]);

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

  // Rostered WINDOWS per (user, day) — the pay basis (owner rule 2026-08-13:
  // only time inside the rostered window is paid). Rest-day markers and
  // unconfirmed AI suggestions aren't shifts. The roster table is the authority
  // rather than the log's clock-in stamp, so a manager who adds a missing shift
  // after the fact fixes that day's pay.
  // PUBLISHED rosters only (owner 2026-08-14). The roster no longer just CAPS
  // pay, it DEFINES it — so an unpublished draft must not set anyone's wages.
  // The POS open-store gate has always required `published`; this brings payroll
  // into line. A day whose only shift is a draft now reads as unrostered, i.e. a
  // cover shift a manager confirms, rather than silently pricing off a sketch.
  const { data: publishedScheds } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id")
    .eq("status", "published")
    .lte("week_start", periodEndStr)
    .gte("week_end", periodStartStr);
  const publishedIds = ((publishedScheds ?? []) as Array<{ id: string }>).map((r) => r.id);
  const { data: rosterRows } = publishedIds.length
    ? await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id, shift_date, start_time, end_time, break_minutes, notes")
        .in("user_id", ptIds)
        .in("schedule_id", publishedIds)
        .gte("shift_date", periodStartStr)
        .lte("shift_date", periodEndStr)
    : { data: [] as Array<Record<string, unknown>> };
  const schedByUserDay = new Map<string, ShiftWindow[]>();
  for (const s of (rosterRows ?? []) as Array<{ user_id: string; shift_date: string; start_time: string; end_time: string; break_minutes: number | null; notes: string | null }>) {
    // A rest-day row is start == end (00:00–00:00) — zero-length, not a shift.
    // Matching on start_time "00:00" alone would also drop a genuine
    // midnight-start shift; pickShiftWindow's own rest-day guard backstops this.
    if (s.start_time === s.end_time) continue;
    if (s.notes === "pt_suggestion") continue;
    const start = mytInstant(s.shift_date, s.start_time);
    const end = mytInstant(s.shift_date, s.end_time);
    if (!start || !end) continue;
    const key = `${s.user_id}:${s.shift_date}`;
    schedByUserDay.set(key, [...(schedByUserDay.get(key) ?? []), { start, end, breakMinutes: s.break_minutes }]);
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
  // Ordered by clock_in so the per-day approved-OT budget splits across a
  // day's logs deterministically (the pt-hours preview orders the same way).
  type Log = { user_id: string; clock_in: string; clock_out: string | null; total_hours: number | string | null; final_status: string | null; regular_hours: number | string | null; overtime_hours: number | string | null };
  const { data: logsRaw } = ptIds.length
    ? await hrSupabaseAdmin
        .from("hr_attendance_logs")
        .select("user_id, clock_in, clock_out, total_hours, final_status, regular_hours, overtime_hours")
        .in("user_id", ptIds)
        .gte("clock_in", weekStartIso)
        .lt("clock_in", weekEndExclusiveIso)
        .not("clock_out", "is", null)
        .order("clock_in")
    : { data: [] as Log[] };

  const logsByUser = new Map<string, Log[]>();
  for (const l of (logsRaw || []) as Log[]) {
    if (l.final_status === "rejected") continue; // bogus entry — don't pay
    const list = logsByUser.get(l.user_id) || [];
    list.push(l);
    logsByUser.set(l.user_id, list);
  }

  // 3. A SETTLED week is never recomputed (owner 2026-08-14: "forward only,
  //    don't restate the paid week").
  //
  //    The wipe below only removes draft/ai_computed runs, so a confirmed or
  //    paid run survives it — but the INSERT that follows would then add a
  //    SECOND run for the same period, silently, with no unique constraint on
  //    (cycle_type, period_start) to stop it. The week would end up with two
  //    runs disagreeing about what it owes, and reporting or the bank file
  //    could pick up either.
  //
  //    That matters now the pay basis has changed: recomputing the paid
  //    2026-07-27 week under the paid-window rules moves individuals by up to
  //    RM66 in both directions. Restating it would mean recovering wages
  //    already paid, which Employment Act s.24 constrains — so refuse outright
  //    rather than leave it to whoever clicks Compute.
  const { data: settled } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id, status")
    .eq("cycle_type", "weekly")
    .eq("period_start", periodStartStr)
    .in("status", ["confirmed", "paid"])
    .maybeSingle();
  if (settled) {
    throw new Error(
      `Week ${periodStartStr} already has a ${settled.status} payroll run (${settled.id}) — refusing to recompute. ` +
        `Reopen or void that run first if it genuinely needs restating.`,
    );
  }

  // Wipe any existing draft/computed weekly run for this period.
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
  let paidLogCount = 0;

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
    // weekend rate / 2× on a public holiday) over the PAID WINDOW — the overlap
    // of the clocked span with the rostered shift (owner rule 2026-08-13).
    // Overstay past the rostered end pays only against an approved OT request.
    let workedHours = 0;
    let paidHours = 0;
    let unpaidHours = 0;
    let gross = 0;
    let overlapTrimmedMin = 0;
    const logDetails: Array<{ date: string; hours: number; paid_hours: number; capped: boolean; rate: number; start: string; end: string; manager_adjusted?: boolean; overlap_trimmed_minutes?: number }> = [];
    // A day's approved-OT budget is shared across that day's logs (split shifts).
    const otLeft = new Map<string, number>();
    // Overlapping logs must not pay the same minutes twice — clip each log to
    // the span nobody else has claimed (manager-adjusted logs claim first).
    const clipped = clipOverlappingLogs(userLogs);
    for (const { log: l, clockIn, clockOut, trimmedMinutes } of clipped) {
      const dateStr = mytDateString(l.clock_in);
      const dayKey = `${profile.user_id}:${dateStr}`;
      const rate = ptRateForDate(profile, dateStr, holidaySet.has(dateStr));
      // What they were on the clock for (raw span) — the yardstick the
      // "unpaid" note compares against.
      const worked = Math.round(
        ((new Date(l.clock_out as string).getTime() - new Date(l.clock_in).getTime()) / (1000 * 60 * 60)) * 100,
      ) / 100;

      // A manager-ADJUSTED log is a human verdict on this shift's hours
      // (set_times or the attendance queue's adjust — nothing automated writes
      // "adjusted"). Pay it as stated: window math would silently override the
      // manager, while the bank-file gate treats the log as confirmed.
      if (l.final_status === "adjusted") {
        const stated = Math.round(((Number(l.regular_hours) || 0) + (Number(l.overtime_hours) || 0)) * 100) / 100;
        workedHours += worked;
        paidHours += stated;
        gross += stated * rate;
        paidLogCount++;
        logDetails.push({ date: dateStr, hours: worked, paid_hours: stated, capped: false, rate, start: l.clock_in, end: l.clock_out as string, manager_adjusted: true });
        continue;
      }

      const window = pickShiftWindow(schedByUserDay.get(dayKey) ?? [], clockIn, clockOut);
      const w = paidWindowHours({
        clockIn, clockOut,
        scheduledStart: window?.start ?? null,
        scheduledEnd: window?.end ?? null,
        breakMinutes: window?.breakMinutes ?? null,
        employmentType: profile.employment_type || "part_time",
      });

      // Time outside the window — early in (rule 5) or late out (rule 4) — is
      // unpaid unless an approved OT request covers it, and only counts in whole
      // 30-min brackets (rule 6).
      if (!otLeft.has(dayKey)) otLeft.set(dayKey, otByUserDay.get(dayKey) ?? 0);
      const otPaid = Math.round(Math.min(w.otEligibleHours, otLeft.get(dayKey)!) * 100) / 100;
      otLeft.set(dayKey, Math.max(0, otLeft.get(dayKey)! - otPaid));

      const paid = Math.round((w.paidHours + otPaid) * 100) / 100;
      workedHours += worked;
      paidHours += paid;
      // Overlap-trimmed minutes are duplicated time, not window drift — keep
      // them out of the "clocked outside the rostered window" figure.
      unpaidHours += Math.max(0, worked - trimmedMinutes / 60 - w.breakHours - paid);
      gross += paid * rate;
      overlapTrimmedMin += trimmedMinutes;
      paidLogCount++;
      logDetails.push({
        date: dateStr, hours: worked, paid_hours: paid, capped: paid < worked - w.breakHours, rate,
        start: l.clock_in, end: l.clock_out as string,
        ...(trimmedMinutes > 0 ? { overlap_trimmed_minutes: trimmedMinutes } : {}),
      });
    }
    if (overlapTrimmedMin > 0) {
      notes.push(
        `${profile.user_id.slice(0, 8)}: ${overlapTrimmedMin}min of OVERLAPPING logs excluded from pay — the same span was clocked twice; review and reject the duplicate log.`,
      );
    }
    workedHours = Math.round(workedHours * 100) / 100;
    paidHours = Math.round(paidHours * 100) / 100;
    unpaidHours = Math.round(unpaidHours * 100) / 100;
    gross = Math.round(gross * 100) / 100;
    totalGross += gross;
    if (unpaidHours > 0.01) {
      notes.push(
        `${profile.user_id.slice(0, 8)}: ${unpaidHours}h clocked outside the rostered window (clocked ${workedHours}h, paid ${paidHours}h) — early/late clock drift is unpaid; approve an OT request or fix the roster to pay it.`,
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
        employment_type: profile.employment_type || "part_time",
        cycle: "weekly",
        basis: "paid window (clocked ∩ rostered shift), day-aware rate (weekday/weekend/PH 2x), + approved OT in 30-min brackets",
        worked_hours: workedHours,
        paid_hours: paidHours,
        unpaid_outside_window_hours: unpaidHours,
        attendance_records: logDetails.length,
        shifts: logDetails,
      },
    });
  }

  if (payrollItems.length > 0) {
    const { error: itemsError } = await hrSupabaseAdmin
      .from("hr_payroll_items")
      .insert(payrollItems);
    if (itemsError) {
      // Don't strand an EMPTY ai_computed run: confirmed as-is it would settle
      // the week at RM0 and the settled-guard would then defend it forever.
      await hrSupabaseAdmin.from("hr_payroll_runs").delete().eq("id", run.id);
      throw new Error(`Failed to save payroll items: ${itemsError.message}`);
    }
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
