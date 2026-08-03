import { hrSupabaseAdmin } from "../supabase";
import { WORKING_DAYS_PER_MONTH, NORMAL_WORKING_HOURS_PER_DAY, OT_RATES } from "../constants";
import { computeAllowancesForUser, loadAllowanceRules } from "../allowances";
import { calcAllStatutory } from "../statutory/calculators";
import { computeProrate, prorateAmount } from "../payroll/prorate";
import { mytDateString } from "../hours";

type PayrollResult = {
  payrollRunId: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  notes: string[];
};

// EPF / SOCSO / EIS / HRDF / PCB now computed via ../statutory/calculators.ts
// using the hr_stat_* reference tables. Legacy inline funcs removed.

/**
 * AI Payroll Calculator
 *
 * Computes monthly payroll for all employees with HR profiles.
 * Uses approved attendance data for OT calculations.
 * Applies Malaysia statutory deductions (EPF, SOCSO, EIS, PCB).
 */
export async function calculatePayroll(month: number, year: number): Promise<PayrollResult> {
  const notes: string[] = [];

  // 0. Refuse to recompute a confirmed/paid period. Operators can still
  // recompute "draft" or "ai_computed" runs; those are overwritten below.
  const { data: lockedRuns } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id, status")
    .eq("period_month", month)
    .eq("period_year", year)
    .in("status", ["confirmed", "paid"])
    .limit(1);
  if (lockedRuns && lockedRuns.length > 0) {
    throw new Error(
      `Payroll for ${year}-${String(month).padStart(2, "0")} is already ${lockedRuns[0].status}. ` +
      `Delete or unlock the existing run before recomputing.`,
    );
  }

  // 0b. Warn loudly when the cycle hasn't finished. A monthly run computed on
  // day 1 has no attendance to read: every line comes out with 0 regular hours
  // and 0 OT, and the performance levers score an empty month. The August 2026
  // run was computed on 1 August and did exactly that across 28 people.
  //
  // This is a WARNING, not a block — a mid-month preview is legitimate, and
  // the run stays 'ai_computed' until someone confirms it. But it must be
  // impossible to confirm a run like this without having been told.
  const lastDayOfCycle = new Date(year, month, 0).getDate();
  const cycleEndsAt = Date.UTC(year, month - 1, lastDayOfCycle, 23, 59, 59);
  if (Date.now() < cycleEndsAt) {
    const daysLeft = Math.ceil((cycleEndsAt - Date.now()) / 86_400_000);
    notes.push(
      `⚠ ${year}-${String(month).padStart(2, "0")} has not ended — ${daysLeft} day${daysLeft === 1 ? "" : "s"} remain. ` +
      `Attendance for the rest of the cycle does not exist yet, so OT and attendance-derived ` +
      `allowances are incomplete. Recompute after month end before confirming.`,
    );
  }

  // 1. Get all employee profiles
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("*");

  if (!profiles || profiles.length === 0) {
    throw new Error("No employee profiles found. Set up employee HR profiles first.");
  }

  // Per-user pre-flight — skip invalid profiles instead of aborting the
  // whole run. Reasons get surfaced in `notes` so the UI can show them
  // against the affected staff.
  const cycleStartStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const cycleEndStr = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const skippedUsers = new Map<string, string>();

  // FT→PT CONVERTERS.
  //
  // employment_type is a single CURRENT value with no date range, so the moment
  // someone moves from a monthly salary to hourly, this run stops seeing them —
  // including for the part of the month they were still salaried. Zarif (FT to
  // 2026-07-07) and Danish (FT to 2026-07-11) both fell out of July entirely and
  // were owed RM451.61 and RM674.19 that nothing would ever have paid.
  //
  // hr_salary_history already records it correctly: a `monthly` row that ENDS
  // inside this cycle, followed by an `hourly` one. Take that as the FT stint.
  // Their hours AFTER the switch belong to the weekly PT run, not here.
  const { data: stintRows } = await hrSupabaseAdmin
    .from("hr_salary_history")
    .select("user_id, amount, effective_date, end_date")
    .eq("salary_type", "monthly")
    .eq("status", "approved")
    .not("end_date", "is", null)
    .gte("end_date", cycleStartStr)
    .lte("end_date", cycleEndStr);
  const ftStints = new Map<string, { amount: number; endDate: string }>();
  for (const row of (stintRows || []) as { user_id: string; amount: unknown; end_date: string }[]) {
    const amount = Number(row.amount);
    // A zero or unreadable amount is a data gap, not a free month. Leaving them
    // out keeps them visible as "missing from payroll" instead of silently
    // paying RM0 and looking settled. (Danish sat at 0.00 until it was
    // recovered from his Apr/May/Jun payslips.)
    if (!Number.isFinite(amount) || amount <= 0) continue;
    ftStints.set(row.user_id, { amount, endDate: row.end_date });
  }

  for (const p of profiles) {
    // Resigned before this cycle → don't include in this run at all.
    // Use end_date (last working day) for payroll cutoff. resigned_at is the
    // letter-submission date and may be weeks before the actual last day.
    const resignDate = p.end_date || p.resigned_at || null;
    if (resignDate && resignDate < cycleStartStr) {
      skippedUsers.set(p.user_id, `resigned ${resignDate}`);
      continue;
    }
    // Monthly cycle is for FULL-TIMERS only. Part-timers (and anyone else paid
    // by the hour) run through /hr/payroll/weekly. Exclude them silently — no
    // skip note needed since this is by design, not a data issue.
    const stint = ftStints.get(p.user_id);
    if (p.employment_type !== "full_time" && stint) {
      // Salaried for part of this cycle. Present them to the rest of the run as
      // a full-timer whose engagement ended on the stint's last day, which is
      // exactly what computeProrate already knows how to handle — it prorates a
      // resigner over calendar days, giving RM2,000 x 7/31 for Zarif.
      p.employment_type = "full_time";
      p.basic_salary = stint.amount;
      p.end_date = stint.endDate;
      notes.push(
        `${p.user_id.slice(0, 8)}: paid the monthly stint to ${stint.endDate} ` +
        `(RM${stint.amount.toFixed(2)} prorated); hours after that are the weekly run's.`,
      );
    } else if (p.employment_type !== "full_time") {
      skippedUsers.set(p.user_id, `not full-time (${p.employment_type || "unset"}) — handled by weekly run`);
      continue;
    }
    if (
      p.schedule_required !== false
      && (p.basic_salary == null || Number(p.basic_salary) === 0)
    ) {
      skippedUsers.set(p.user_id, "full-timer missing basic_salary");
      continue;
    }
  }

  // Don't spam notes with "not full-time" — that's by design. Only call out
  // skips that an HR admin should actually fix.
  let nonFullTimeSkips = 0;
  for (const [uid, reason] of skippedUsers) {
    if (reason.startsWith("not full-time")) {
      nonFullTimeSkips++;
      continue;
    }
    notes.push(`Skipped ${uid.slice(0, 8)}: ${reason}`);
  }
  if (nonFullTimeSkips > 0) {
    notes.push(`${nonFullTimeSkips} non-full-time staff excluded — they run via the weekly cycle.`);
  }

  // Filter the profiles list down to those we'll actually process.
  const eligibleProfiles = profiles.filter((p) => !skippedUsers.has(p.user_id));

  if (eligibleProfiles.length === 0) {
    throw new Error(
      `No eligible employees to compute. ${skippedUsers.size} skipped — see notes for details.`,
    );
  }

  // 2. Get approved attendance for this month
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  // Fetch ALL logs in the pay period. Approval is applied per-log in
  // the aggregation loop below (see isApprovedLog). Paying-out rules:
  //   - AI auto-approved (ai_status='approved', final_status=null) → pay
  //   - Manager approved after review (final_status='approved') → pay
  //   - Manager adjusted hours (final_status='adjusted') → pay
  //   - Rejected OR still pending/flagged/reviewed-unactioned → don't pay
  const { data: attendance } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("*")
    .gte("clock_in", startDate)
    .lt("clock_in", endDate)
    // NULL-safe "not rejected": PostgREST `.neq` compiles to `final_status <>
    // 'rejected'`, which is FALSE for NULL rows and silently drops them — but
    // the AI-auto-approved happy path is exactly `final_status = NULL` (see the
    // paying-out rules above). Dropping those means unpaid shifts. Keep NULL +
    // any non-rejected value; exclude only explicit rejections.
    .or("final_status.is.null,final_status.neq.rejected");

  // Group attendance by user
  const attendanceByUser = new Map<string, typeof attendance>();
  (attendance || []).forEach((a: { user_id: string }) => {
    const list = attendanceByUser.get(a.user_id) || [];
    list.push(a);
    attendanceByUser.set(a.user_id, list);
  });

  // A converter's attendance spans both engagements. Only the salaried part
  // belongs to this run — their later hours are paid hourly by the weekly cycle,
  // and counting the OT here would pay it twice.
  for (const [userId, stint] of ftStints) {
    const logs = attendanceByUser.get(userId);
    if (!logs) continue;
    attendanceByUser.set(
      userId,
      logs.filter((l: { clock_in: string }) => mytDateString(l.clock_in) <= stint.endDate),
    );
  }

  // 2b. YTD totals — cumulative gross and PCB for the year so far. LHDN's MTD
  // formula is cumulative (PCB = [(P−M)R + B − Z − X] / (n+1), where X is PCB
  // already deducted), so this is the single most load-bearing input to PCB:
  // understate it and the projection lands in a lower bracket.
  //
  // Two sources, and they OVERLAP:
  //   - the "opening_balance" run (period_month NULL, period_start/period_end
  //     spanning the imported window) carrying the BrioHR Jan–Jun YTD;
  //   - the monthly runs, which were ALSO imported for part of that same window.
  //
  // The old query tried to union both and got it wrong twice over. It filtered
  // `status in (confirmed, paid)` — but an opening balance is an import artifact
  // that is never "paid", so it sat at `draft` and the `cycle_type.eq.opening_balance`
  // clause was dead: the balance never counted, despite the comment saying it did.
  // Ariff had no Jan/Feb monthly line (that import covered only 19 of 27 people),
  // so his YTD came in RM23,019.23 short, his projected annual fell from
  // RM128,019 to RM105,000, and July PCB was computed in the 19% bracket instead
  // of 25% — RM504.50 against BrioHR's RM1,054.15.
  //
  // Simply un-filtering the status would have been worse: 32 of the 34 people DO
  // have complete monthly lines for the imported window, so counting both would
  // roughly double their YTD. Instead, take the opening balance as authoritative
  // for the window it declares, and only add monthly runs from AFTER that window.
  // Per user, because someone with no opening-balance row still needs their
  // monthly lines counted from January.
  const { data: openingRuns } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id, period_end")
    .eq("period_year", year)
    .eq("cycle_type", "opening_balance");
  const openingRun = (openingRuns || [])[0] as { id: string; period_end: string | null } | undefined;
  // Last month the opening balance already accounts for; 0 when there is none.
  const openingCoversThroughMonth = openingRun?.period_end
    ? Number(openingRun.period_end.slice(5, 7))
    : 0;

  const ytdByUser = new Map<string, { gross: number; pcb: number }>();
  const addYtd = (userId: string, gross: unknown, pcb: unknown) => {
    const existing = ytdByUser.get(userId) || { gross: 0, pcb: 0 };
    existing.gross += Number(gross || 0);
    existing.pcb += Number(pcb || 0);
    ytdByUser.set(userId, existing);
  };

  // YTD gross must be TAXABLE gross. A line that paid a reimbursement carries
  // it in total_gross (the money was paid) but not in computation_details
  // .pcb_gross. Prefer the latter when the line has it; fall back to
  // total_gross for older lines and for the imported opening balance, which
  // predate the field.
  const taxableGrossOf = (p: { total_gross: unknown; computation_details?: unknown }) => {
    const details = p.computation_details as { pcb_gross?: unknown } | null | undefined;
    const pcbGross = details?.pcb_gross;
    return pcbGross != null && Number.isFinite(Number(pcbGross)) ? Number(pcbGross) : Number(p.total_gross || 0);
  };

  const coveredByOpening = new Set<string>();
  if (openingRun) {
    const { data: openingItems } = await hrSupabaseAdmin
      .from("hr_payroll_items")
      .select("user_id, total_gross, pcb_tax, computation_details")
      .eq("payroll_run_id", openingRun.id);
    for (const p of openingItems || []) {
      coveredByOpening.add(p.user_id);
      addYtd(p.user_id, taxableGrossOf(p), p.pcb_tax);
    }
  }

  const { data: priorRuns } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id, period_month")
    .eq("period_year", year)
    .eq("cycle_type", "monthly")
    .lt("period_month", month)
    .in("status", ["confirmed", "paid"]);
  const priorMonthByRun = new Map<string, number>(
    (priorRuns || []).map((r: { id: string; period_month: number }) => [r.id, Number(r.period_month)]),
  );
  if (priorMonthByRun.size > 0) {
    const { data: priorItems } = await hrSupabaseAdmin
      .from("hr_payroll_items")
      .select("user_id, total_gross, pcb_tax, payroll_run_id, computation_details")
      .in("payroll_run_id", [...priorMonthByRun.keys()]);
    for (const p of priorItems || []) {
      const itemMonth = priorMonthByRun.get(p.payroll_run_id) ?? 0;
      // Already inside the opening balance for this person — don't count twice.
      if (coveredByOpening.has(p.user_id) && itemMonth <= openingCoversThroughMonth) continue;
      addYtd(p.user_id, taxableGrossOf(p), p.pcb_tax);
    }
  }

  // 3. Get approved leave for unpaid leave deductions
  const { data: leaves } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("user_id, leave_type, total_days")
    .in("status", ["approved", "ai_approved"])
    .gte("start_date", startDate)
    .lt("end_date", endDate)
    .eq("leave_type", "unpaid");

  const unpaidLeaveByUser = new Map<string, number>();
  (leaves || []).forEach((l: { user_id: string; total_days: number }) => {
    unpaidLeaveByUser.set(l.user_id, (unpaidLeaveByUser.get(l.user_id) || 0) + Number(l.total_days));
  });

  // 3b. Recurring per-employee items (allowances + deductions) active in this cycle.
  // Joined with catalog so we know category/statutory flags. Statutory math is
  // applied per-flag in the per-employee loop below.
  const lastDay = new Date(year, month, 0).getDate();
  const cycleStartIso = `${year}-${String(month).padStart(2, "0")}-01`;
  const cycleEndIso = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const { data: recurringRows } = await hrSupabaseAdmin
    .from("hr_employee_recurring_items")
    .select("user_id, catalog_code, kind, amount, effective_date, end_date, note")
    .lte("effective_date", cycleEndIso)
    .or(`end_date.is.null,end_date.gte.${cycleStartIso}`);

  const recurringByUser = new Map<string, Array<{
    catalog_code: string; kind: string; amount: number; note: string | null;
  }>>();
  for (const r of recurringRows || []) {
    const list = recurringByUser.get(r.user_id) || [];
    list.push({
      catalog_code: r.catalog_code,
      kind: r.kind,
      amount: Number(r.amount),
      note: r.note,
    });
    recurringByUser.set(r.user_id, list);
  }

  // Catalog metadata for the codes referenced above (avoids 1 lookup per row)
  const referencedCodes = Array.from(new Set((recurringRows || []).map((r: { catalog_code: string }) => r.catalog_code)));
  const { data: catalogRows } = referencedCodes.length
    ? await hrSupabaseAdmin
        .from("hr_payroll_item_catalog")
        .select("code, name, category, item_type, pcb_taxable, epf_contributing, socso_contributing, eis_contributing")
        .in("code", referencedCodes)
    : { data: [] as Array<{ code: string }> };
  const catalogByCode = new Map((catalogRows || []).map((c: { code: string }) => [c.code, c]));

  // 3c. Per-employee tax reliefs declared for this period_year. PCB calc
  // accepts them via tp3Reliefs map { relief_code → amount }. Unknown codes
  // are added at face value (un-capped) by the PCB calc — caps from the
  // catalog's max_amount could later be enforced server-side at entry time.
  // 50%-claimable reliefs (alimony etc.) get half the declared amount per
  // LHDN rules; we collapse 100% + 50%/2 into a single effective figure.
  const { data: reliefRows } = await hrSupabaseAdmin
    .from("hr_employee_tax_reliefs")
    .select("user_id, relief_code, amount_100pct, amount_50pct")
    .eq("year", year);
  const reliefsByUser = new Map<string, Record<string, number>>();
  for (const r of reliefRows || []) {
    const map = reliefsByUser.get(r.user_id) || {};
    const effective = Number(r.amount_100pct || 0) + Number(r.amount_50pct || 0) / 2;
    if (effective > 0) {
      map[r.relief_code] = (map[r.relief_code] || 0) + effective;
      reliefsByUser.set(r.user_id, map);
    }
  }

  // 4. Create payroll run
  // Delete existing draft for this period
  await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .delete()
    .eq("period_month", month)
    .eq("period_year", year)
    .in("status", ["draft", "ai_computed"]);

  const { data: run, error: runError } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .insert({
      period_month: month,
      period_year: year,
      status: "ai_computed",
      ai_computed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (runError) throw new Error(`Failed to create payroll run: ${runError.message}`);

  // 5. Load allowance rules once — shared across all users
  const allowanceRules = await loadAllowanceRules();

  // Employer-level HRDF (PSMB) registration. Read once, applied per employee
  // below — an unregistered employer owes no levy at all.
  const { data: companySettings } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("hrdf_number")
    .limit(1)
    .maybeSingle();
  const hrdfRegistered = Boolean(companySettings?.hrdf_number?.trim());
  if (!hrdfRegistered) {
    notes.push("HRDF not levied — no PSMB registration number in company settings.");
  }

  // 6. Calculate per employee — run in parallel. Each employee does 5
  // independent statutory DB round-trips (EPF/SOCSO/EIS/HRDF/PCB); sequential
  // was ~200 RTTs for 40 staff and hit the serverless timeout. All calls
  // are read-only during this phase and inserts are batched after.
  // Accumulator mutations are safe — JS single-threaded, atomic between awaits.
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalEmployerCost = 0;
  const payrollItems: Record<string, unknown>[] = [];

  await Promise.all(eligibleProfiles.map(async (profile) => {
    const basicSalary = Number(profile.basic_salary) || 0;
    const isPartTime = profile.employment_type === "part_time";
    const hourlyRate = isPartTime && profile.hourly_rate
      ? Number(profile.hourly_rate)
      : basicSalary / WORKING_DAYS_PER_MONTH / NORMAL_WORKING_HOURS_PER_DAY;

    // Attendance-based calculations
    const userAttendance = attendanceByUser.get(profile.user_id) || [];
    let totalRegularHours = 0;
    let totalOtHours = 0;
    let ot1xAmount = 0;
    let ot15xAmount = 0;
    let ot2xAmount = 0;
    let ot3xAmount = 0;

    // OT rules:
    //   1. Must be approved (by AI or manager) — unapproved OT isn't paid
    //   2. Must be >= 1 hour on that log — shorter overruns are ignored
    // Regular hours still count regardless (the shift happened, pay for it).
    const OT_MIN_HOURS = 1;
    const isOtApproved = (a: { ai_status: string | null; final_status: string | null }) =>
      a.final_status === "approved" ||
      a.final_status === "adjusted" ||
      (a.ai_status === "approved" && !a.final_status);

    for (const a of userAttendance) {
      totalRegularHours += Number(a.regular_hours) || 0;
      // OT must always be floored to whole hours per Celsius payroll policy.
      // The attendance-processor already floors; this is defensive for any
      // historical data that snuck in rounded.
      const rawOtHours = Math.floor(Number(a.overtime_hours) || 0);
      const otHours = isOtApproved(a) && rawOtHours >= OT_MIN_HOURS ? rawOtHours : 0;
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

    // Prorate — calendar-day based per MY Employment Act. Applies to fixed
    // salary. Skipped for part-timers (paid on actual hours).
    // Priority: joiner → resigner → unpaid leave (first match wins).
    const cycleStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const cycleEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDayOfMonth).padStart(2, "0")}`;
    const unpaidDays = unpaidLeaveByUser.get(profile.user_id) || 0;
    // Is this the last cycle they'll appear in? True whenever a resignation
    // date lands on or before cycle end — including exactly ON cycle end, which
    // proration deliberately ignores because a full month was worked.
    const resignDateStr = profile.end_date || profile.resigned_at || null;
    const isFinalCycle = Boolean(resignDateStr) && String(resignDateStr) <= cycleEnd;

    const prorate = isPartTime
      ? ({ reason: null, daysWorked: 0, daysTotal: 0, factor: 1, explanation: null, basis: "calendar" as const } as ReturnType<typeof computeProrate>)
      : computeProrate({
          cycleStart,
          cycleEnd,
          joinDate: profile.join_date || null,
          resignDate: profile.end_date || profile.resigned_at || null,
          unpaidLeaveDays: unpaidDays,
          fullSalary: basicSalary,
          // Per-employee proration formula: HQ staff use Mon-Fri working
          // days (Section 60I(1C) with contractual denominator), outlet
          // staff use calendar days (Section 60I(1B) statutory default).
          basis: profile.proration_basis ?? "calendar",
        });

    // Base pay
    let basePay: number;
    if (isPartTime) {
      basePay = totalRegularHours * hourlyRate;
    } else {
      basePay = prorateAmount(basicSalary, prorate);
    }

    // Unpaid leave deduction — when prorate.reason='unpaid_leave', the factor
    // already covers it; don't double-deduct. Otherwise apply as a separate line.
    const dailyRate = basicSalary / WORKING_DAYS_PER_MONTH;
    const unpaidDeduction = prorate.reason === "unpaid_leave" ? 0 : unpaidDays * dailyRate;

    // Total OT
    const totalOT = Math.round((ot1xAmount + ot15xAmount + ot2xAmount + ot3xAmount) * 100) / 100;

    // Performance allowance (single RM200 pool, v2). There is NO separate
    // attendance allowance — computed via the shared allowance engine, already
    // net of lateness/absence and negative-review deductions and score tiering.
    const allowanceBreakdown = await computeAllowancesForUser(
      profile.user_id,
      year,
      month,
      allowanceRules,
    );
    // v2 single performance pool: the paid allowance is the levers' earned
    // amount already NET of attendance (late/absent) + negative-review
    // deductions, floored at 0 (breakdown.totalEarned). It's variable incentive
    // pay → added to gross + PCB but excluded from the EPF/SOCSO/EIS basis.
    const perfAllowanceFull = Math.round(allowanceBreakdown.totalEarned * 100) / 100;
    // Prorate the pool for a partial month. The levers score RATES (avg serving
    // time, audit %, checklist completion), not volume, so a joiner who worked
    // five days and scored well earned the WHOLE month's pool: Auni Sefhia
    // joined 2026-07-27 and drew the full RM180 on top of 5/31 of her basic.
    // Unpaid leave is excluded — the allowance engine already nets absence
    // deductions off the pool, and prorating on top would double-count.
    const allowanceProrated =
      prorate.reason === "joiner"
      || prorate.reason === "resigner"
      || prorate.reason === "joiner_and_resigner";
    const perfAllowance = allowanceProrated
      ? prorateAmount(perfAllowanceFull, prorate)
      : perfAllowanceFull;
    const attendanceDeducted = Math.round(allowanceBreakdown.attendance.total * 100) / 100;
    const reviewPenalty = Math.round(allowanceBreakdown.reviewPenalty.total * 100) / 100;
    const totalAllowances = perfAllowance;

    // Recurring per-employee items active this cycle. Apply BEFORE statutory
    // so EPF-contributing additions feed into the basis, and deduct_from_gross
    // items reduce the basis.
    //   - additions: add to gross; if catalog flags EPF + fixed_remuneration,
    //     also add to statutory basis (EPF/SOCSO/EIS).
    //   - deduct_from_gross: reduce both gross and statutory basis.
    //   - deduct_after_net: stash for post-tax subtraction.
    const myRecurring = recurringByUser.get(profile.user_id) || [];
    const recurringAdditionsDetail: Record<string, { amount: number; label: string; code: string; note?: string | null }> = {};
    const recurringPostTax: Array<{ code: string; label: string; amount: number; note: string | null }> = [];
    let recurringAdd = 0;
    let recurringStatBasis = 0;
    let recurringPreTaxDeduct = 0;
    // Recurring ADDITIONS the catalog marks pcb_taxable=false. Paid in full,
    // but subtracted back out of the PCB basis below.
    let recurringNonTaxableAdd = 0;
    for (const ri of myRecurring) {
      const cat = catalogByCode.get(ri.catalog_code) as
        | { code: string; name: string; category: string; item_type: string;
            pcb_taxable: boolean; epf_contributing: boolean;
            socso_contributing: boolean; eis_contributing: boolean }
        | undefined;
      if (!cat) continue;
      const amt = Math.round(ri.amount * 100) / 100;
      if (ri.kind === "deduction") {
        if (cat.item_type === "deduct_after_net") {
          recurringPostTax.push({ code: cat.code, label: cat.name, amount: amt, note: ri.note });
        } else {
          // Treat anything else as deduct_from_gross
          recurringPreTaxDeduct += amt;
          recurringAdditionsDetail[cat.code] = { amount: -amt, label: cat.name, code: cat.code, note: ri.note };
        }
      } else {
        recurringAdd += amt;
        if (cat.epf_contributing && cat.item_type === "fixed_remuneration") {
          recurringStatBasis += amt;
        }
        // Not every payment is taxable income. A mileage reimbursement, a
        // parking/meal allowance, a non-taxable perquisite — the catalog marks
        // these pcb_taxable=false, and they must NOT inflate the PCB basis.
        // The flag was fetched and then never read, so they did: Adam Kelvin's
        // RM315 of approved mileage claims pushed his projected annual income
        // to RM46,596.60 and his chargeable past the RM400 rebate, costing him
        // RM9.45 on a FINAL payslip he can't be re-issued.
        if (!cat.pcb_taxable) {
          recurringNonTaxableAdd += amt;
        }
        recurringAdditionsDetail[cat.code] = { amount: amt, label: cat.name, code: cat.code, note: ri.note };
      }
    }

    // Gross = basic + OT − unpaid + allowances + recurring additions − pre-tax recurring deductions.
    // Review penalty is post-tax (other_deductions) so it doesn't reduce the statutory/PCB basis.
    // Clamp to 0 so heavy unpaid-leave doesn't produce a negative payslip.
    const rawGross = basePay + totalOT - unpaidDeduction + totalAllowances + recurringAdd - recurringPreTaxDeduct;
    const gross = Math.max(0, Math.round(rawGross * 100) / 100);
    if (rawGross < 0) {
      notes.push(
        `⚠ Negative gross clamped to 0 for ${profile.user_id.slice(0, 8)} ` +
        `— unpaid leave exceeded earnings. Review before confirming.`,
      );
    }

    // The PCB basis is gross MINUS anything the catalog says isn't taxable
    // income. It stays in `gross` because the money is genuinely paid and has
    // to reach the bank file — it just isn't remuneration for tax.
    //
    // Additions only. The flag's meaning on a DEDUCTION is ambiguous (UNPAID_LEAVE
    // carries pcb_taxable=false, yet unpaid leave plainly does reduce taxable
    // income), so deductions keep their existing behaviour rather than being
    // changed on a guess.
    const pcbGross = Math.max(0, Math.round((gross - recurringNonTaxableAdd) * 100) / 100);
    if (recurringNonTaxableAdd > 0) {
      notes.push(
        `${profile.user_id.slice(0, 8)}: RM${recurringNonTaxableAdd.toFixed(2)} of non-taxable ` +
        `payments (reimbursements/allowances) paid but excluded from the PCB basis.`,
      );
    }

    // Statutory deductions via hr_stat_* reference tables.
    // Malaysian convention (KWSP/PERKESO): EPF + SOCSO + EIS basis = basic +
    // FIXED recurring allowances only. The performance allowance is VARIABLE
    // incentive pay and therefore excluded from the statutory basis. PCB still
    // uses full gross annualized.
    const statutoryBasis = Math.max(0, basePay - unpaidDeduction + recurringStatBasis - recurringPreTaxDeduct);
    const ytd = ytdByUser.get(profile.user_id) || { gross: 0, pcb: 0 };
    const employeeReliefs = reliefsByUser.get(profile.user_id);
    const stat = await calcAllStatutory({
      wage: statutoryBasis,
      // PERKESO SOCSO/EIS wages include overtime; EPF (statutoryBasis) excludes
      // it. Pass the OT-inclusive figure so SOCSO/EIS aren't under-contributed.
      socsoEisWage: statutoryBasis + totalOT,
      // PCB is assessed on TAXABLE income, not on everything paid — see pcbGross.
      monthlyGross: pcbGross,
      currentMonth: month,
      periodYear: year,
      periodMonth: month,
      ytdGross: ytd.gross,
      ytdTaxPaid: ytd.pcb,
      employmentType: profile.employment_type as string | undefined,
      epfCategory: (profile.epf_category as "A" | "B" | "C") || "A",
      epfEmployeeRateOverride: profile.epf_employee_rate ? Number(profile.epf_employee_rate) : undefined,
      epfEmployerRateOverride: profile.epf_employer_rate ? Number(profile.epf_employer_rate) : undefined,
      socsoCategory: (profile.socso_category as "invalidity_injury" | "injury_only" | "exempt") || "invalidity_injury",
      eisEnabled: profile.eis_enabled !== false,
      // HRDF (PSMB) is only payable once the EMPLOYER is registered with PSMB.
      // Nothing checked that: `hrdf_relation` is a per-employee exemption and
      // defaults to "non_related", so the levy was charged to a company that
      // has never registered — RM635.00 of phantom employer cost on the July
      // 2026 run. Gate on the registration number in hr_company_settings, which
      // also means HRDF switches itself on the moment that number is filled in.
      // (hr_stat_hrdf_config.min_employees stays advisory — registration, not
      // headcount, is what makes the levy due.)
      hrdfApplicable: hrdfRegistered && profile.hrdf_relation !== "exempt",
      monthlyZakat: profile.zakat_enabled ? Number(profile.zakat_amount || 0) : 0,
      taxResidentCategory: (profile.tax_resident_category as "normal" | "knowledge_worker" | "returning_expert") || "normal",
      tp3Reliefs: employeeReliefs,
    });

    const epfRates = stat.epf;
    const socsoRates = stat.socso;
    const eisRates = stat.eis;
    const pcb = stat.pcb;
    const zakat = stat.zakat;

    // NOTE: the negative-review penalty is already netted INTO perfAllowance
    // (gross is lower by that amount), so it is NOT subtracted again here —
    // doing so would double-count it. Recurring deduct_after_net items still
    // subtract post-tax (e.g. CP38 tax orders).
    const recurringPostTaxTotal = recurringPostTax.reduce((s, d) => s + d.amount, 0);
    const totalDeduct = Math.round((epfRates.employee + socsoRates.employee + eisRates.employee + pcb + zakat + recurringPostTaxTotal + recurringPreTaxDeduct) * 100) / 100;
    const netPay = Math.round((gross - epfRates.employee - socsoRates.employee - eisRates.employee - pcb - zakat - recurringPostTaxTotal) * 100) / 100;
    const employerCost = Math.round((epfRates.employer + socsoRates.employer + eisRates.employer + stat.hrdf.employer) * 100) / 100;

    totalGross += gross;
    totalDeductions += totalDeduct;
    totalNet += netPay;
    totalEmployerCost += employerCost;

    // Structured allowance breakdown for payslip transparency. Single
    // performance pool: show the lever earnings + the deductions that netted
    // against it (attendance + negative reviews).
    const allowancesDetail: Record<string, unknown> = {};
    if (allowanceBreakdown.eligible) {
      allowancesDetail.performance = {
        amount: perfAllowance,
        pool: allowanceBreakdown.pool,
        gross_earned: allowanceBreakdown.performanceEarned,
        levers: allowanceBreakdown.levers,
        attendance_deductions: allowanceBreakdown.attendance.deductions,
        attendance_deducted: attendanceDeducted,
        review_entries: allowanceBreakdown.reviewPenalty.entries,
        review_deducted: reviewPenalty,
        // Present only on a partial month, so the payslip can show why the
        // earned pool and the paid amount differ.
        ...(allowanceProrated
          ? {
              prorated_from: perfAllowanceFull,
              prorate_days_worked: prorate.daysWorked,
              prorate_days_total: prorate.daysTotal,
            }
          : {}),
      };
    }
    // Recurring additions / pre-tax deductions show up in allowancesDetail with
    // the catalog code as key (negative amount = deduction) so the payslip
    // renderer surfaces them as line items.
    for (const [code, val] of Object.entries(recurringAdditionsDetail)) {
      allowancesDetail[code] = val;
    }

    const otherDeductions: Record<string, unknown> = {};
    if (unpaidDeduction > 0) otherDeductions.unpaid_leave = unpaidDeduction;
    if (zakat > 0) otherDeductions.zakat = zakat;
    // Review penalty is netted into the performance allowance (above), not a
    // separate post-tax deduction line — see allowancesDetail.performance.
    // Post-tax recurring deductions (e.g. CP38, salary advance recovery)
    for (const d of recurringPostTax) {
      otherDeductions[d.code] = { amount: d.amount, label: d.label, note: d.note };
    }

    payrollItems.push({
      payroll_run_id: run.id,
      user_id: profile.user_id,
      // Prorate metadata — surfaced on payslip + review UI
      prorate_reason: prorate.reason,
      prorate_days_worked: prorate.reason ? prorate.daysWorked : null,
      prorate_days_total: prorate.reason ? prorate.daysTotal : null,
      basic_salary: basePay,
      total_regular_hours: Math.round(totalRegularHours * 100) / 100,
      total_ot_hours: Math.round(totalOtHours * 100) / 100,
      ot_1x_amount: Math.round(ot1xAmount * 100) / 100,
      ot_1_5x_amount: Math.round(ot15xAmount * 100) / 100,
      ot_2x_amount: Math.round(ot2xAmount * 100) / 100,
      ot_3x_amount: Math.round(ot3xAmount * 100) / 100,
      allowances: allowancesDetail,
      total_gross: gross,
      epf_employee: epfRates.employee,
      socso_employee: socsoRates.employee,
      eis_employee: eisRates.employee,
      pcb_tax: pcb,
      other_deductions: otherDeductions,
      total_deductions: totalDeduct,
      net_pay: netPay,
      epf_employer: epfRates.employer,
      socso_employer: socsoRates.employer,
      eis_employer: eisRates.employer,
      computation_details: {
        // Taxable gross for this month. Differs from total_gross whenever a
        // non-taxable payment (reimbursement, non-taxable allowance) was paid.
        // The YTD aggregation prefers this over total_gross so a reimbursement
        // doesn't re-inflate NEXT month's projected annual income either.
        pcb_gross: pcbGross,
        hourly_rate: Math.round(hourlyRate * 100) / 100,
        employment_type: profile.employment_type,
        unpaid_days: unpaidDays,
        attendance_records: userAttendance.length,
        allowance_earned: perfAllowance,
        allowance_gross_earned: allowanceBreakdown.performanceEarned,
        allowance_attendance_deducted: attendanceDeducted,
        allowance_eligible: allowanceBreakdown.eligible,
        review_penalty: reviewPenalty,
        // Final-payroll marker: this is the staffer's LAST cycle. HR should add
        // leave encashment + notice-pay manually via an ad-hoc adjustment line
        // before confirming the run.
        //
        // Keyed off "no cycle after this one", not off the prorate reason.
        // Proration only fires when the last day falls strictly INSIDE the
        // cycle, so someone whose last day is the final day of the month — a
        // full month's pay, no proration — was never marked final. Adam Kelvin
        // left on 2026-07-31 and his July payslip would have gone out unmarked.
        final_payroll: isFinalCycle,
        resignation_end_date: isFinalCycle ? (profile.end_date || profile.resigned_at) : null,
      },
    });
  }));

  // Summarise any final payrolls in this cycle for HR review
  const finalPayrollNames: string[] = [];
  for (const item of payrollItems) {
    const cd = item.computation_details as { final_payroll?: boolean } | undefined;
    if (cd?.final_payroll) {
      const p = profiles.find((pp: { user_id: string }) => pp.user_id === item.user_id);
      const u = p ? (p as { user_id: string; full_name?: string }).full_name : undefined;
      finalPayrollNames.push(u || String(item.user_id).slice(0, 8));
    }
  }
  if (finalPayrollNames.length > 0) {
    notes.push(`⚠ Final payroll for: ${finalPayrollNames.join(", ")} — add leave encashment / notice pay if applicable before confirming`);
  }

  // 6. Insert payroll items
  if (payrollItems.length > 0) {
    const { error: itemsError } = await hrSupabaseAdmin
      .from("hr_payroll_items")
      .insert(payrollItems);
    if (itemsError) throw new Error(`Failed to save payroll items: ${itemsError.message}`);
  }

  // 7. Update run totals
  totalGross = Math.round(totalGross * 100) / 100;
  totalDeductions = Math.round(totalDeductions * 100) / 100;
  totalNet = Math.round(totalNet * 100) / 100;
  totalEmployerCost = Math.round(totalEmployerCost * 100) / 100;

  await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .update({
      total_gross: totalGross,
      total_deductions: totalDeductions,
      total_net: totalNet,
      total_employer_cost: totalEmployerCost,
      ai_notes: `${profiles.length} employees processed. Total gross: RM ${totalGross.toLocaleString()}, Net: RM ${totalNet.toLocaleString()}, Employer cost: RM ${totalEmployerCost.toLocaleString()}`,
    })
    .eq("id", run.id);

  notes.push(`${profiles.length} employees, ${(attendance || []).length} attendance records`);
  notes.push(`Gross: RM ${totalGross.toLocaleString()}`);
  notes.push(`Deductions: RM ${totalDeductions.toLocaleString()} (EPF + SOCSO + EIS + PCB)`);
  notes.push(`Net: RM ${totalNet.toLocaleString()}`);
  notes.push(`Employer statutory: RM ${totalEmployerCost.toLocaleString()}`);

  return {
    payrollRunId: run.id,
    employeeCount: profiles.length,
    totalGross,
    totalDeductions,
    totalNet,
    totalEmployerCost,
    notes,
  };
}
