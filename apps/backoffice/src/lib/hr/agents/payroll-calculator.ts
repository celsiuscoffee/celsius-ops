import { hrSupabaseAdmin } from "../supabase";
import { WORKING_DAYS_PER_MONTH, NORMAL_WORKING_HOURS_PER_DAY, OT_RATES } from "../constants";
import { computeAllowancesForUser, loadAllowanceRules } from "../allowances";
import { calcAllStatutory } from "../statutory/calculators";
import { computeProrate, prorateAmount } from "../payroll/prorate";

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
  const skippedUsers = new Map<string, string>();

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
    if (p.employment_type !== "full_time") {
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
    .neq("final_status", "rejected");

  // Group attendance by user
  const attendanceByUser = new Map<string, typeof attendance>();
  (attendance || []).forEach((a: { user_id: string }) => {
    const list = attendanceByUser.get(a.user_id) || [];
    list.push(a);
    attendanceByUser.set(a.user_id, list);
  });

  // 2b. YTD totals — sum confirmed runs earlier in the same year for PCB carryover
  const { data: priorRuns } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("id")
    .eq("period_year", year)
    .lt("period_month", month)
    .in("status", ["confirmed", "paid"]);
  const priorRunIds = (priorRuns || []).map((r: { id: string }) => r.id);
  const ytdByUser = new Map<string, { gross: number; pcb: number }>();
  if (priorRunIds.length > 0) {
    const { data: priorItems } = await hrSupabaseAdmin
      .from("hr_payroll_items")
      .select("user_id, total_gross, pcb_tax")
      .in("payroll_run_id", priorRunIds);
    for (const p of priorItems || []) {
      const existing = ytdByUser.get(p.user_id) || { gross: 0, pcb: 0 };
      existing.gross += Number(p.total_gross || 0);
      existing.pcb += Number(p.pcb_tax || 0);
      ytdByUser.set(p.user_id, existing);
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

    // Allowances (attendance + performance), review penalty deduction.
    // Computed via the shared allowance engine — already net of attendance
    // penalties (late/absent/early-out) and performance score tiering.
    const allowanceBreakdown = await computeAllowancesForUser(
      profile.user_id,
      year,
      month,
      allowanceRules,
    );
    const attendanceAllowance = Math.round(allowanceBreakdown.attendance.earned * 100) / 100;
    const performanceAllowance = Math.round(allowanceBreakdown.performance.earned * 100) / 100;
    const reviewPenalty = Math.round(allowanceBreakdown.reviewPenalty.total * 100) / 100;
    const totalAllowances = Math.round((attendanceAllowance + performanceAllowance) * 100) / 100;

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

    // Statutory deductions via hr_stat_* reference tables.
    // Malaysian convention (KWSP/PERKESO): EPF + SOCSO + EIS basis = basic +
    // FIXED recurring allowances only. Attendance allowance is contractually
    // fixed (capped); performance allowance is VARIABLE incentive pay and
    // therefore excluded from the statutory basis. PCB still uses full gross
    // annualized.
    const statutoryBasis = Math.max(0, basePay - unpaidDeduction + attendanceAllowance + recurringStatBasis - recurringPreTaxDeduct);
    const ytd = ytdByUser.get(profile.user_id) || { gross: 0, pcb: 0 };
    const employeeReliefs = reliefsByUser.get(profile.user_id);
    const stat = await calcAllStatutory({
      wage: statutoryBasis,
      monthlyGross: gross,
      currentMonth: month,
      ytdGross: ytd.gross,
      ytdTaxPaid: ytd.pcb,
      employmentType: profile.employment_type as string | undefined,
      epfCategory: (profile.epf_category as "A" | "B" | "C") || "A",
      epfEmployeeRateOverride: profile.epf_employee_rate ? Number(profile.epf_employee_rate) : undefined,
      epfEmployerRateOverride: profile.epf_employer_rate ? Number(profile.epf_employer_rate) : undefined,
      socsoCategory: (profile.socso_category as "invalidity_injury" | "injury_only" | "exempt") || "invalidity_injury",
      eisEnabled: profile.eis_enabled !== false,
      hrdfApplicable: profile.hrdf_relation !== "exempt",
      monthlyZakat: profile.zakat_enabled ? Number(profile.zakat_amount || 0) : 0,
      taxResidentCategory: (profile.tax_resident_category as "normal" | "knowledge_worker" | "returning_expert") || "normal",
      tp3Reliefs: employeeReliefs,
    });

    const epfRates = stat.epf;
    const socsoRates = stat.socso;
    const eisRates = stat.eis;
    const pcb = stat.pcb;
    const zakat = stat.zakat;

    // Review penalty is post-tax: subtract from net.
    // Recurring deduct_after_net items also subtract post-tax (e.g. CP38 tax orders).
    const recurringPostTaxTotal = recurringPostTax.reduce((s, d) => s + d.amount, 0);
    const totalDeduct = Math.round((epfRates.employee + socsoRates.employee + eisRates.employee + pcb + zakat + reviewPenalty + recurringPostTaxTotal + recurringPreTaxDeduct) * 100) / 100;
    const netPay = Math.round((gross - epfRates.employee - socsoRates.employee - eisRates.employee - pcb - zakat - reviewPenalty - recurringPostTaxTotal) * 100) / 100;
    const employerCost = Math.round((epfRates.employer + socsoRates.employer + eisRates.employer + stat.hrdf.employer) * 100) / 100;

    totalGross += gross;
    totalDeductions += totalDeduct;
    totalNet += netPay;
    totalEmployerCost += employerCost;

    // Structured allowance breakdown for payslip transparency
    const allowancesDetail: Record<string, unknown> = {};
    if (attendanceAllowance > 0) {
      allowancesDetail.attendance = {
        amount: attendanceAllowance,
        base: allowanceBreakdown.attendance.base,
        penalties: allowanceBreakdown.attendance.penalties,
      };
    }
    if (performanceAllowance > 0) {
      allowancesDetail.performance = {
        amount: performanceAllowance,
        base: allowanceBreakdown.performance.base,
        score: allowanceBreakdown.performance.score,
        breakdown: allowanceBreakdown.performance.breakdown,
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
    if (reviewPenalty > 0) {
      otherDeductions.review_penalty = {
        amount: reviewPenalty,
        entries: allowanceBreakdown.reviewPenalty.entries,
      };
    }
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
        hourly_rate: Math.round(hourlyRate * 100) / 100,
        employment_type: profile.employment_type,
        unpaid_days: unpaidDays,
        attendance_records: userAttendance.length,
        allowance_attendance_earned: attendanceAllowance,
        allowance_performance_earned: performanceAllowance,
        allowance_performance_eligible: allowanceBreakdown.performance.eligible,
        review_penalty: reviewPenalty,
        // Final-payroll marker: staff resigned this cycle. HR should add
        // leave encashment + notice-pay manually via an ad-hoc adjustment
        // line before confirming the run.
        final_payroll: prorate.reason === "resigner" || prorate.reason === "joiner_and_resigner",
        resignation_end_date: (prorate.reason === "resigner" || prorate.reason === "joiner_and_resigner")
          ? (profile.end_date || profile.resigned_at)
          : null,
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
