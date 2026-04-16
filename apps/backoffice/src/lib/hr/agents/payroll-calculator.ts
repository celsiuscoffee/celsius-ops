import { hrSupabaseAdmin } from "../supabase";
import { WORKING_DAYS_PER_MONTH, NORMAL_WORKING_HOURS_PER_DAY, OT_RATES } from "../constants";

type PayrollResult = {
  payrollRunId: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerCost: number;
  notes: string[];
};

// 2026 Malaysia EPF rates
function calcEPF(gross: number, employeeRate: number, employerRate: number) {
  // EPF applies to gross wages (excluding OT for some configs, but Celsius includes all)
  const employee = Math.round(gross * (employeeRate / 100) * 100) / 100;
  // Employer rate: 13% if wages <= RM5000, 12% if > RM5000
  const effectiveEmployerRate = gross <= 5000 ? Math.max(employerRate, 13) : employerRate;
  const employer = Math.round(gross * (effectiveEmployerRate / 100) * 100) / 100;
  return { employee, employer };
}

// 2026 SOCSO rates (simplified — Employment Injury + Invalidity)
function calcSOCSO(gross: number) {
  // Only applies to wages <= RM4000 (or if opted in above)
  // Employee: ~0.5%, Employer: ~1.75%
  const cap = Math.min(gross, 4000);
  const employee = Math.round(cap * 0.005 * 100) / 100;
  const employer = Math.round(cap * 0.0175 * 100) / 100;
  return { employee, employer };
}

// 2026 EIS rates
function calcEIS(gross: number) {
  // Employee: 0.2%, Employer: 0.2%, max insured salary RM4000
  const cap = Math.min(gross, 4000);
  const employee = Math.round(cap * 0.002 * 100) / 100;
  const employer = Math.round(cap * 0.002 * 100) / 100;
  return { employee, employer };
}

// Simplified PCB (Monthly Tax Deduction) — bracket-based
function calcPCB(annualTaxable: number) {
  // Very simplified — real PCB needs marital status, children, reliefs
  // Using single, no children, standard relief RM9000
  const taxable = Math.max(0, annualTaxable - 9000);
  let tax = 0;
  if (taxable <= 5000) tax = 0;
  else if (taxable <= 20000) tax = (taxable - 5000) * 0.01;
  else if (taxable <= 35000) tax = 150 + (taxable - 20000) * 0.03;
  else if (taxable <= 50000) tax = 600 + (taxable - 35000) * 0.06;
  else if (taxable <= 70000) tax = 1500 + (taxable - 50000) * 0.11;
  else if (taxable <= 100000) tax = 3700 + (taxable - 70000) * 0.19;
  else tax = 9400 + (taxable - 100000) * 0.25;

  // Monthly = annual / 12
  return Math.round((tax / 12) * 100) / 100;
}

/**
 * AI Payroll Calculator
 *
 * Computes monthly payroll for all employees with HR profiles.
 * Uses approved attendance data for OT calculations.
 * Applies Malaysia statutory deductions (EPF, SOCSO, EIS, PCB).
 */
export async function calculatePayroll(month: number, year: number): Promise<PayrollResult> {
  const notes: string[] = [];

  // 1. Get all employee profiles
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("*");

  if (!profiles || profiles.length === 0) {
    throw new Error("No employee profiles found. Set up employee HR profiles first.");
  }

  // 2. Get approved attendance for this month
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const { data: attendance } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("*")
    .gte("clock_in", startDate)
    .lt("clock_in", endDate)
    .in("ai_status", ["approved", "reviewed"])
    .or("final_status.eq.approved,final_status.eq.adjusted");

  // Group attendance by user
  const attendanceByUser = new Map<string, typeof attendance>();
  (attendance || []).forEach((a: { user_id: string }) => {
    const list = attendanceByUser.get(a.user_id) || [];
    list.push(a);
    attendanceByUser.set(a.user_id, list);
  });

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

  // 5. Calculate per employee
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalEmployerCost = 0;
  const payrollItems: Record<string, unknown>[] = [];

  for (const profile of profiles) {
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

    // Base pay
    let basePay: number;
    if (isPartTime) {
      basePay = totalRegularHours * hourlyRate;
    } else {
      basePay = basicSalary;
    }

    // Unpaid leave deduction
    const unpaidDays = unpaidLeaveByUser.get(profile.user_id) || 0;
    const dailyRate = basicSalary / WORKING_DAYS_PER_MONTH;
    const unpaidDeduction = unpaidDays * dailyRate;

    // Total OT
    const totalOT = Math.round((ot1xAmount + ot15xAmount + ot2xAmount + ot3xAmount) * 100) / 100;

    // Gross
    const gross = Math.round((basePay + totalOT - unpaidDeduction) * 100) / 100;

    // Statutory deductions
    const epfRates = calcEPF(gross, Number(profile.epf_employee_rate) || 11, Number(profile.epf_employer_rate) || 12);
    const socsoRates = calcSOCSO(gross);
    const eisRates = calcEIS(gross);
    const pcb = calcPCB(gross * 12); // annualize for PCB bracket

    const totalDeduct = Math.round((epfRates.employee + socsoRates.employee + eisRates.employee + pcb) * 100) / 100;
    const netPay = Math.round((gross - totalDeduct) * 100) / 100;
    const employerCost = Math.round((epfRates.employer + socsoRates.employer + eisRates.employer) * 100) / 100;

    totalGross += gross;
    totalDeductions += totalDeduct;
    totalNet += netPay;
    totalEmployerCost += employerCost;

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
      epf_employee: epfRates.employee,
      socso_employee: socsoRates.employee,
      eis_employee: eisRates.employee,
      pcb_tax: pcb,
      other_deductions: unpaidDeduction > 0 ? { unpaid_leave: unpaidDeduction } : {},
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
      },
    });
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
