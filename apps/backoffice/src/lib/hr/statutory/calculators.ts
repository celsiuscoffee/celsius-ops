// Malaysia statutory contribution calculators.
// Uses hr_stat_* reference tables rather than hardcoded rates so rates can be
// updated via SQL when KWSP/PERKESO/LHDN publish new schedules.

import { hrSupabaseAdmin } from "../supabase";

export type EpfInputs = {
  wage: number;              // OT + basic + fixed allowances (EPF-contributing items only)
  epfCategory: "A" | "B" | "C";   // A = citizen <60, B = citizen 60+, C = non-citizen
  employeeRateOverride?: number;  // custom voluntary rate if set
  employerRateOverride?: number;
};

export type StatRates = {
  epf: { employee: number; employer: number };
  socso: { employee: number; employer: number };
  eis: { employee: number; employer: number };
  hrdf: { employer: number };
};

// ─── EPF (KWSP Act 452) ─────────────────────────────────────────
// Wage rounded UP to RM20 bracket per Schedule A.
// Rate depends on category (A/B/C) and wage threshold RM5000.
export async function calcEPF(
  inputs: EpfInputs,
  effectiveDate: Date = new Date(),
): Promise<{ employee: number; employer: number; bracket: number }> {
  if (inputs.wage <= 10) return { employee: 0, employer: 0, bracket: 0 };

  const { data: rate } = await hrSupabaseAdmin
    .from("hr_stat_epf_rates")
    .select("*")
    .eq("category", inputs.epfCategory)
    .lte("effective_from", effectiveDate.toISOString().slice(0, 10))
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rate) return { employee: 0, employer: 0, bracket: 0 };

  const bracket = Math.ceil(inputs.wage / 20) * 20;
  const employeeRate = inputs.employeeRateOverride ?? Number(rate.employee_rate);
  const employerRate = inputs.employerRateOverride ?? Number(
    inputs.wage <= 5000 ? rate.employer_rate_below_5000 : rate.employer_rate_above_5000,
  );

  // EPF Schedule A rounds up to nearest RM for contributions
  const employee = Math.ceil((bracket * employeeRate) / 100);
  const employer = Math.ceil((bracket * employerRate) / 100);

  return { employee, employer, bracket };
}

// ─── SOCSO (Act 4) ──────────────────────────────────────────────
// Category 1 (under 60): invalidity + injury. Category 2 (60+): injury only.
// Wage capped at RM6,000 (2022 amendment). Rounded UP to nearest RM100 tier.
// Contributions rounded to nearest RM0.05.
export async function calcSOCSO(
  wage: number,
  category: 1 | 2,
  enabled = true,
  effectiveDate: Date = new Date(),
): Promise<{ employee: number; employer: number; tier: number }> {
  if (!enabled || wage <= 30) return { employee: 0, employer: 0, tier: 0 };

  const { data: cfg } = await hrSupabaseAdmin
    .from("hr_stat_socso_config")
    .select("*")
    .lte("effective_from", effectiveDate.toISOString().slice(0, 10))
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cfg) return { employee: 0, employer: 0, tier: 0 };

  const cappedWage = Math.min(wage, Number(cfg.wage_ceiling));
  const tier = Math.ceil(cappedWage / Number(cfg.round_to)) * Number(cfg.round_to);

  if (category === 1) {
    const employee = roundToCents(tier * (Number(cfg.cat1_employee_rate) / 100));
    const employer = roundToCents(tier * (Number(cfg.cat1_employer_rate) / 100));
    return { employee, employer, tier };
  } else {
    // Category 2: employer-only, injury-only scheme
    const employer = roundToCents(tier * (Number(cfg.cat2_employer_rate) / 100));
    return { employee: 0, employer, tier };
  }
}

// ─── EIS (Act 800) ──────────────────────────────────────────────
// 0.2% + 0.2%, cap RM6,000, rounded to RM0.05.
export async function calcEIS(
  wage: number,
  enabled = true,
  effectiveDate: Date = new Date(),
): Promise<{ employee: number; employer: number; tier: number }> {
  if (!enabled || wage <= 30) return { employee: 0, employer: 0, tier: 0 };

  const { data: cfg } = await hrSupabaseAdmin
    .from("hr_stat_eis_config")
    .select("*")
    .lte("effective_from", effectiveDate.toISOString().slice(0, 10))
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cfg) return { employee: 0, employer: 0, tier: 0 };

  const cappedWage = Math.min(wage, Number(cfg.wage_ceiling));
  const tier = Math.ceil(cappedWage / Number(cfg.round_to)) * Number(cfg.round_to);

  const employee = roundToCents(tier * (Number(cfg.employee_rate) / 100));
  const employer = roundToCents(tier * (Number(cfg.employer_rate) / 100));
  return { employee, employer, tier };
}

// ─── HRDF (PSMB) ────────────────────────────────────────────────
// 1% employer, no cap, applies to employers with 10+ Malaysian employees.
export async function calcHRDF(
  wage: number,
  applicable = true,
  effectiveDate: Date = new Date(),
): Promise<{ employer: number }> {
  if (!applicable || wage <= 0) return { employer: 0 };
  const { data: cfg } = await hrSupabaseAdmin
    .from("hr_stat_hrdf_config")
    .select("*")
    .lte("effective_from", effectiveDate.toISOString().slice(0, 10))
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cfg) return { employer: 0 };
  return { employer: roundToCents(wage * (Number(cfg.employer_rate) / 100)) };
}

// ─── PCB 2026 MTD Formula Method (LHDN PU(A) 354/2020) ─────────
// Simplified for regular monthly remuneration (not TP3 mid-year):
//   PCB = [(P - M) × R + B] − Z − X    (then divided into remaining months)
// where:
//   P = Annual chargeable income
//   M = First chargeable income tier (0, 5000, 20000, ...)
//   R = Marginal tax rate for that bracket
//   B = Accumulated tax on prior brackets
//   Z = Zakat already paid this year
//   X = PCB already deducted this year
//
// For simple monthly calc: annualize current-month income, apply reliefs,
// look up bracket, compute annual tax, divide by 12, subtract zakat.
export type PcbInputs = {
  monthlyGross: number;          // current-month gross (excluding statutory)
  currentMonth?: number;         // 1-12; defaults to today's month
  ytdGross?: number;             // prior months cumulative gross
  ytdTaxPaid?: number;           // prior months PCB paid
  annualEpfContribution: number; // employee EPF for full year (projected)
  annualSocsoEisContribution?: number;
  monthlyZakat?: number;
  reliefs?: Record<string, number>;  // { PERSONAL: 9000, CHILD_UNDER_18: 2, ... }
  childrenUnder18?: number;      // quick-fill
  childrenHigherEd?: number;
  spouseNotWorking?: boolean;
  disabledSelf?: boolean;
  disabledSpouse?: boolean;
  taxResidentCategory?: "normal" | "knowledge_worker" | "returning_expert";
};

export async function calcPCB(
  inputs: PcbInputs,
  year = new Date().getFullYear(),
): Promise<{ monthlyPCB: number; annualChargeableIncome: number; annualTax: number; debug: Record<string, unknown> }> {
  // Load brackets + default reliefs
  const [bracketsRes, reliefsRes] = await Promise.all([
    hrSupabaseAdmin.from("hr_stat_pcb_brackets").select("*").eq("effective_year", year).order("bracket_min"),
    hrSupabaseAdmin.from("hr_stat_pcb_reliefs").select("*").eq("effective_year", year),
  ]);
  const brackets = bracketsRes.data || [];
  const reliefCatalog = new Map<string, number>(
    (reliefsRes.data || []).map((r: { relief_code: string; amount: number }) => [r.relief_code, Number(r.amount)]),
  );

  // Project annual income from YTD + projected remaining months
  const ytdGross = inputs.ytdGross ?? 0;
  const ytdPaid = inputs.ytdTaxPaid ?? 0;
  const currentMonth = inputs.currentMonth ?? (new Date().getMonth() + 1);
  const remainingMonths = Math.max(1, 12 - (currentMonth - 1));

  // Annual gross = YTD + (current month + remaining months projected at current rate)
  const projectedAnnual = ytdGross + inputs.monthlyGross * remainingMonths;

  // Apply reliefs
  let totalRelief = 0;
  const r = inputs.reliefs ?? {};

  // Standard personal
  totalRelief += reliefCatalog.get("PERSONAL") ?? 9000;

  // EPF + life insurance combined cap (7000)
  const epfCap = reliefCatalog.get("EPF_CAP") ?? 7000;
  totalRelief += Math.min(inputs.annualEpfContribution, epfCap);

  // SOCSO+EIS cap
  if (inputs.annualSocsoEisContribution) {
    totalRelief += Math.min(inputs.annualSocsoEisContribution, reliefCatalog.get("SOCSO_EIS_CAP") ?? 350);
  }

  // Spouse not working
  if (inputs.spouseNotWorking) totalRelief += reliefCatalog.get("SPOUSE") ?? 4000;

  // Disabled
  if (inputs.disabledSelf) totalRelief += reliefCatalog.get("DISABLED_SELF") ?? 6000;
  if (inputs.disabledSpouse) totalRelief += reliefCatalog.get("DISABLED_SPOUSE") ?? 5000;

  // Children
  const perChild = reliefCatalog.get("CHILD_UNDER_18") ?? 2000;
  const perChildHigherEd = reliefCatalog.get("CHILD_HIGHER_ED") ?? 8000;
  totalRelief += (inputs.childrenUnder18 ?? 0) * perChild;
  totalRelief += (inputs.childrenHigherEd ?? 0) * perChildHigherEd;

  // Custom reliefs (TP3)
  for (const [code, amount] of Object.entries(r)) {
    const max = reliefCatalog.get(code);
    if (max !== undefined) totalRelief += Math.min(amount, max);
    else totalRelief += amount;
  }

  const chargeableIncome = Math.max(0, projectedAnnual - totalRelief);

  // Look up bracket and compute annual tax
  let annualTax = 0;
  for (const b of brackets) {
    const min = Number(b.bracket_min);
    const max = b.bracket_max === null ? Infinity : Number(b.bracket_max);
    if (chargeableIncome > min) {
      if (chargeableIncome <= max) {
        annualTax = Number(b.tax_on_min) + (chargeableIncome - min) * (Number(b.rate_over_min) / 100);
        break;
      }
    }
  }

  // Knowledge worker / returning expert: flat 15% rate (replaces standard progressive)
  if (inputs.taxResidentCategory === "knowledge_worker" || inputs.taxResidentCategory === "returning_expert") {
    annualTax = chargeableIncome * 0.15;
  }

  // Subtract annual zakat
  const annualZakat = (inputs.monthlyZakat ?? 0) * 12;
  const netAnnualTax = Math.max(0, annualTax - annualZakat);

  // PCB this month = (annual tax − YTD paid) / remaining months, rounded to RM 0.05
  const remainingTax = Math.max(0, netAnnualTax - ytdPaid);
  const monthlyPCB = roundToCents(remainingTax / remainingMonths);

  return {
    monthlyPCB,
    annualChargeableIncome: chargeableIncome,
    annualTax: Math.round(annualTax * 100) / 100,
    debug: {
      totalRelief,
      projectedAnnual,
      annualZakat,
      ytdPaid,
      remainingMonths,
    },
  };
}

// ─── One-shot helper: compute all statutory contributions for an employee ──
export type EmployeeStatutoryInputs = {
  wage: number;
  monthlyGross: number;
  currentMonth?: number;
  ytdGross?: number;
  ytdTaxPaid?: number;
  // Profile
  employmentType?: "full_time" | "part_time" | "contract" | "intern" | string;
  epfCategory?: "A" | "B" | "C";
  epfEmployeeRateOverride?: number;
  epfEmployerRateOverride?: number;
  socsoCategory?: "invalidity_injury" | "injury_only" | "exempt";
  eisEnabled?: boolean;
  hrdfApplicable?: boolean;
  monthlyZakat?: number;
  taxResidentCategory?: "normal" | "knowledge_worker" | "returning_expert";
  spouseNotWorking?: boolean;
  childrenUnder18?: number;
  childrenHigherEd?: number;
  disabledSelf?: boolean;
  disabledSpouse?: boolean;
  tp3Reliefs?: Record<string, number>;
};

export async function calcAllStatutory(inputs: EmployeeStatutoryInputs) {
  // CONTRACT staff are paid on invoice / service agreement — no statutory
  // contributions (no EPF/SOCSO/EIS/HRDF/PCB). Return a zeroed result so the
  // caller's ledger math still works without a special case.
  if (inputs.employmentType === "contract") {
    return {
      epf: { employee: 0, employer: 0 },
      socso: { employee: 0, employer: 0 },
      eis: { employee: 0, employer: 0 },
      hrdf: { employer: 0 },
      pcb: 0,
      zakat: 0,
      pcbDebug: { skipped: "contract — no statutory deductions" },
    };
  }

  const epfCat = inputs.epfCategory ?? "A";
  const socsoCat = inputs.socsoCategory === "injury_only" ? 2
    : inputs.socsoCategory === "exempt" ? null : 1;

  const epf = await calcEPF({
    wage: inputs.wage,
    epfCategory: epfCat,
    employeeRateOverride: inputs.epfEmployeeRateOverride,
    employerRateOverride: inputs.epfEmployerRateOverride,
  });

  const socso = socsoCat
    ? await calcSOCSO(inputs.wage, socsoCat as 1 | 2, true)
    : { employee: 0, employer: 0, tier: 0 };

  const eis = await calcEIS(inputs.wage, inputs.eisEnabled ?? true);

  const hrdf = await calcHRDF(inputs.wage, inputs.hrdfApplicable ?? true);

  const pcb = await calcPCB({
    monthlyGross: inputs.monthlyGross,
    currentMonth: inputs.currentMonth,
    ytdGross: inputs.ytdGross,
    ytdTaxPaid: inputs.ytdTaxPaid,
    annualEpfContribution: epf.employee * 12,
    annualSocsoEisContribution: (socso.employee + eis.employee) * 12,
    monthlyZakat: inputs.monthlyZakat,
    childrenUnder18: inputs.childrenUnder18,
    childrenHigherEd: inputs.childrenHigherEd,
    spouseNotWorking: inputs.spouseNotWorking,
    disabledSelf: inputs.disabledSelf,
    disabledSpouse: inputs.disabledSpouse,
    taxResidentCategory: inputs.taxResidentCategory,
    reliefs: inputs.tp3Reliefs,
  });

  return {
    epf: { employee: epf.employee, employer: epf.employer },
    socso: { employee: socso.employee, employer: socso.employer },
    eis: { employee: eis.employee, employer: eis.employer },
    hrdf: { employer: hrdf.employer },
    pcb: pcb.monthlyPCB,
    zakat: inputs.monthlyZakat ?? 0,
    pcbDebug: pcb.debug,
  };
}

function roundToCents(amount: number): number {
  return Math.round(amount * 20) / 20;  // round to RM 0.05
}
