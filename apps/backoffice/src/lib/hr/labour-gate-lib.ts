// Labour-cost gate for weekly rosters — the "gate" step of the people-cost
// gating loop (docs/design/people-cost-gating-loop.md).
//
// Prices a draft week's roster against a revenue forecast and returns a
// verdict the publish endpoint enforces:
//   green  — projected labour % ≤ outlet target: publish freely
//   amber  — ≤ ceiling: publish requires a typed reason (logged)
//   red    — > ceiling: owner override only
//   unknown — no revenue history to forecast from (treated like amber)
//
// Costing follows the manpower workbook's definition of outlet labour:
// line-staff FT (gross + employer statutory) + part-timers + ⅓ of the
// rover lead's cost. Rovers (Area Manager / Head of Dept / Barista Lead)
// are NOT costed per shift — the AM & HoD sit in HQ overhead and the
// rover lead arrives via the fixed weekly share — but their shifts count
// against the 2-days-per-outlet rover quota.

import {
  WORKING_DAYS_PER_MONTH,
  NORMAL_WORKING_HOURS_PER_DAY,
} from "./constants";

// Per-outlet labour budgets (fraction of forecast revenue), keyed by
// Outlet.code. Tamarind's interim budget is deliberately above the company
// 18% target: its 3-pax service floor can't reach 18% at current weekday
// revenue — the fix there is sales growth, reviewed monthly, not a gate
// that cries wolf every week.
export const OUTLET_BUDGETS: Record<string, { target: number; ceiling: number }> = {
  CC001: { target: 0.18, ceiling: 0.2 }, // Conezion (Putrajaya) — owner set 18/20, 2026-07-05
  CC002: { target: 0.18, ceiling: 0.2 }, // Shah Alam
  CC003: { target: 0.22, ceiling: 0.25 }, // Tamarind — interim, revenue plan attached
};
export const DEFAULT_BUDGET = { target: 0.18, ceiling: 0.2 };

// ⅓ of the rover lead's monthly cost (gross + employer statutory, RM4,022/mo
// per the manpower workbook) charged to each of the three revenue outlets,
// expressed per roster week.
export const ROVER_SHARE_WEEKLY = Math.round(((4022 / 3) * 12) / 52); // ≈ RM309

// HR positions treated as rovers/HQ: never costed per shift, but capped at
// 2 shifts per outlet-week (the rover rotation).
const ROVER_POSITIONS = new Set(["manager", "area manager", "head of department", "barista lead"]);
export const ROVER_WEEKLY_QUOTA = 2;

// Employer statutory on top of FT gross when the profile doesn't carry an
// explicit EPF employer rate: EPF 13% (≤RM5k band) + SOCSO 1.75% + EIS 0.2%.
// Contribution caps are ignored — this is a planning gate, not payroll.
const DEFAULT_EMPLOYER_STATUTORY = 0.13 + 0.0175 + 0.002;

export type ShiftCostRow = {
  user_id: string;
  shift_date: string;
  start_time: string; // HH:MM:SS
  end_time: string;
  userName: string;
  position: string | null;
  employment_type: string | null; // null = no HR profile
  hourly_rate: number | null;
  basic_salary: number | null;
  epf_employer_rate: number | null;
};

export type LabourGateResult = {
  outletId: string;
  outletCode: string;
  outletName: string;
  weekStart: string;
  forecastRevenue: number;
  rosterCost: number;
  // Cost split — FT salaries + rover are SUNK (fixed regardless of the grid);
  // PT is the only spend the roster actually moves. Benching FT never lowers
  // ftFixedCost, so it can't lower the %: the discretionary lever is PT + revenue.
  ftFixedCost: number;
  ptCost: number;
  rosterHours: number;
  pct: number | null; // null when forecast is 0
  targetPct: number;
  ceilingPct: number;
  verdict: "green" | "amber" | "red" | "unknown";
  blockers: string[]; // data problems that refuse publish outright
  warnings: string[]; // quota breaches etc. — publish allowed, logged
  // Per-day demand coverage: staff-hours needed (hourly sales / RM69) vs
  // staff-hours rostered; shortHours > 0 means the day is under-covered.
  // forecast/pct/isWeekend/isHoliday surface the weekday-vs-weekend labour split
  // (pct is INDICATIVE: day hours × blended rate ÷ day forecast — FT salary is a
  // weekly fixed cost, so daily % is a coverage lens, not the billed figure).
  coverage: Array<{
    date: string; neededHours: number; scheduledHours: number; shortHours: number;
    forecast?: number; pct?: number | null; isWeekend?: boolean; isHoliday?: boolean; holidayName?: string;
  }>;
};

export function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let h = eh + em / 60 - (sh + sm / 60);
  if (h < 0) h += 24; // overnight closing shift
  return h;
}

function normalizeRate(rate: number | null): number | null {
  if (rate == null) return null;
  return rate > 1 ? rate / 100 : rate; // stored as 13 or 0.13 depending on writer
}

// Pure costing over pre-joined rows — unit-testable without IO.
export function costRoster(rows: ShiftCostRow[]): {
  cost: number;
  hours: number;
  blockers: string[];
  warnings: string[];
} {
  let cost = 0;
  let hours = 0;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const roverShiftCount = new Map<string, { name: string; count: number }>();

  for (const r of rows) {
    const h = shiftHours(r.start_time, r.end_time);
    const position = (r.position ?? "").trim().toLowerCase();

    if (ROVER_POSITIONS.has(position)) {
      // Rover/HQ: RM0 to the outlet, but count toward the rotation quota.
      const entry = roverShiftCount.get(r.user_id) ?? { name: r.userName, count: 0 };
      entry.count += 1;
      roverShiftCount.set(r.user_id, entry);
      continue;
    }

    hours += h;

    if (r.employment_type == null) {
      blockers.push(`${r.userName}: scheduled ${r.shift_date} but has no HR profile — cost unknown`);
      continue;
    }
    if (r.employment_type === "part_time") {
      if (!r.hourly_rate || r.hourly_rate <= 0) {
        blockers.push(`${r.userName}: part-timer with no hourly rate`);
        continue;
      }
      cost += h * r.hourly_rate;
    } else {
      if (!r.basic_salary || r.basic_salary <= 0) {
        blockers.push(`${r.userName}: full-timer with no basic salary`);
        continue;
      }
      const hourly = r.basic_salary / WORKING_DAYS_PER_MONTH / NORMAL_WORKING_HOURS_PER_DAY;
      const statutory = normalizeRate(r.epf_employer_rate) ?? 0;
      const employerLoad = statutory > 0 ? statutory + 0.0175 + 0.002 : DEFAULT_EMPLOYER_STATUTORY;
      cost += h * hourly * (1 + employerLoad);
    }
  }

  for (const [, { name, count }] of roverShiftCount) {
    if (count > ROVER_WEEKLY_QUOTA) {
      warnings.push(
        `${name}: ${count} shifts this week at this outlet — rover quota is ${ROVER_WEEKLY_QUOTA}/outlet/week`,
      );
    }
  }

  return { cost, hours, blockers, warnings };
}

// A salaried FT's cost to the outlet per roster week: the full monthly
// gross + employer statutory, prorated to a week — REGARDLESS of hours
// rostered. Salaries are sunk: an FT rostered 30h costs the same as one
// rostered 45h, so pricing FT by rostered hours understates labour %.
export function weeklySalaryShare(basicSalary: number, epfEmployerRate: number | null): number {
  const stat = normalizeRate(epfEmployerRate);
  const load = stat != null && stat > 0 ? stat + 0.0175 + 0.002 : DEFAULT_EMPLOYER_STATUTORY;
  return (basicSalary * (1 + load) * 12) / 52;
}

export function verdictFor(
  pct: number | null,
  budget: { target: number; ceiling: number },
): LabourGateResult["verdict"] {
  if (pct == null) return "unknown";
  if (pct <= budget.target) return "green";
  if (pct <= budget.ceiling) return "amber";
  return "red";
}

