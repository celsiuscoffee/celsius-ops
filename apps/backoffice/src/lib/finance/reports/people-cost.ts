// People cost (salary + employer statutory) for the sourced P&L, on an ACCRUAL
// basis sourced from the HR payroll module instead of the bank feed.
//
// Why: the bank EMPLOYEE_SALARY / STATUTORY_PAYMENT outflows are the CASH
// settlement of payroll. They land when the transfer clears, which is usually
// the following month and split awkwardly across the employer/employee legs, so
// the P&L expense they produced was cash-timed and lagged a month. The cost of
// employing people belongs to the month the work was done. That month is the
// payroll RUN month, and the figure is the run's gross plus the employer-side
// statutory contributions. This module reads exactly that.
//
// Scope:
//   Salary    = SUM(hr_payroll_items.total_gross)         over the monthly runs
//   Statutory = SUM(epf_employer + socso_employer + eis_employer)  (employer only;
//               the employee-side epf/socso/eis/pcb are deductions already inside
//               gross, so they are NOT added again, no double count).
//
// Attribution: item.user_id -> hr_employee_profiles.preferred_outlet_id ->
// fin_outlet_companies.company_id. Per-outlet is the exact assigned-outlet split
// from real staff, not a ratio. Employees with no assigned outlet cannot be
// placed in a company, so their pay lands on a single visible "Unassigned"
// line attributed to the default company (company + consolidated views only),
// never silently dropped.
//
// Source of truth: the BrioHR migration. BrioHR was the prior payroll system;
// its real, PAID figures were migrated as a single "opening_balance" run that
// holds each employee's actual gross and employer statutory for the months it
// covers (2026-01 to 2026-06) as a year-to-date lump. That is the authoritative
// actual, so those months are captured from it, spread evenly across the months
// it covers (the lump carries no per-month split). The in-house 'monthly' runs
// are draft computations, used ONLY for months the BrioHR run does not cover
// (2026-07 onward), until real monthly runs are confirmed there too.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// The BrioHR migration run and the calendar months it covers. Read from the
// opening_balance run's period so it is not hardcoded to the current migration.
type BrioCoverage = { months: Set<string>; n: number };
async function brioCoverage(): Promise<BrioCoverage> {
  const rows = await prisma.$queryRaw<{ ps: Date; pe: Date }[]>(Prisma.sql`
    SELECT period_start AS ps, period_end AS pe
    FROM hr_payroll_runs
    WHERE cycle_type = 'opening_balance' AND period_start IS NOT NULL AND period_end IS NOT NULL
    ORDER BY created_at DESC LIMIT 1
  `);
  const months = new Set<string>();
  if (!rows.length) return { months, n: 0 };
  const ps = rows[0].ps, pe = rows[0].pe;
  let y = ps.getUTCFullYear(), m = ps.getUTCMonth() + 1;
  const ey = pe.getUTCFullYear(), em = pe.getUTCMonth() + 1;
  for (let i = 0; i < 240 && (y < ey || (y === ey && m <= em)); i++) {
    months.add(ymKey(y, m));
    if (++m > 12) { m = 1; y++; }
  }
  return { months, n: months.size };
}

// Split the P&L window into the months BrioHR covers (captured from the paid
// migration, evenly spread) and the months it does not (fall back to the draft
// monthly runs).
function splitWindow(start: string, end: string, brio: BrioCoverage) {
  const all = monthsInWindow(start, end);
  const brioMonths = all.filter((mo) => brio.months.has(ymKey(mo.year, mo.month)));
  const monthlyMonths = all.filter((mo) => !brio.months.has(ymKey(mo.year, mo.month)));
  return { brioMonths, monthlyMonths };
}

// P&L line codes emitted for the two HR-sourced people-cost lines.
export const PEOPLE_SALARY_CODE = "PEOPLE-SALARY";
export const PEOPLE_STAT_CODE = "PEOPLE-STAT";
export const PEOPLE_SALARY_NAME = "Salaries and wages (accrued from payroll)";
export const PEOPLE_STAT_NAME =
  "Statutory contributions, employer EPF/SOCSO/EIS (accrued from payroll)";
// The unassigned-payroll line, attributed to the default company only.
export const PEOPLE_UNASSIGNED_SALARY_NAME = "Unassigned payroll (assign staff outlet in HR)";
export const PEOPLE_UNASSIGNED_STAT_NAME = "Unassigned statutory (assign staff outlet in HR)";

// The [start, end] YYYY-MM-DD window as an inclusive list of (year, month) the
// monthly payroll runs are matched on. A payroll run recognises in its work
// month regardless of the day-of-month the window starts/ends on.
function monthsInWindow(start: string, end: string): { year: number; month: number }[] {
  const [sy, sm] = start.slice(0, 7).split("-").map(Number);
  const [ey, em] = end.slice(0, 7).split("-").map(Number);
  const out: { year: number; month: number }[] = [];
  let y = sy;
  let m = sm;
  // Guard against a malformed window producing an unbounded loop.
  for (let i = 0; i < 240; i++) {
    if (y > ey || (y === ey && m > em)) break;
    out.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export type PeopleCostScope = {
  companyId: string;        // the company the P&L is being built for
  defaultCompanyId: string; // where unassigned pay is attributed
  start: string;
  end: string;
  outletIds: string[];      // the company's outlets, or one when scoped to an outlet
  outletScoped: boolean;    // true when the P&L is a single-outlet view
  // consolidated: the group P&L builds one report PER company with
  // excludeInterCo=true and sums them line-by-line. Each such per-company report
  // must therefore still attribute only its OWN assigned staff (so the group
  // total is each company summed once, not the whole group repeated per entity),
  // and only the default company's report carries the unassigned pool. So
  // consolidated does NOT change the per-company attribution here; it only
  // affects whether the unassigned pool is a valid attribution target, which is
  // already the default-company rule. Kept for signature symmetry / callers.
  consolidated: boolean;
};

export type PeopleCostResult = {
  salary: number;           // assigned salary for this scope
  statutory: number;        // assigned employer statutory for this scope
  unassignedSalary: number; // unassigned pool, only nonzero when it applies to this scope
  unassignedStatutory: number;
};

// The month-window predicate as a raw SQL fragment matching monthly runs whose
// (period_year, period_month) is in the window. Built from the JS month list so
// the accrual boundary is identical to monthsInWindow above.
function monthListPredicate(months: { year: number; month: number }[]): Prisma.Sql {
  if (!months.length) return Prisma.sql`FALSE`;
  const tuples = months.map((mo) => Prisma.sql`(${mo.year}, ${mo.month})`);
  return Prisma.sql`(r.period_year, r.period_month) IN (${Prisma.join(tuples)})`;
}

// Aggregate people cost for a P&L scope. Runs one grouped query over the monthly
// payroll items in the window, bucketed by the employee's company (via assigned
// outlet), and slices out the figures this scope should show:
//   - outlet-scoped view: only the items whose preferred_outlet_id is in scope;
//     the unassigned pool is excluded (it has no outlet).
//   - company view (companyId set, not outlet-scoped): items mapping to that
//     company; plus, when this is the default company, the whole unassigned pool.
//   - consolidated: items summed across all companies plus the unassigned pool.
export async function peopleCostForScope(scope: PeopleCostScope): Promise<PeopleCostResult> {
  const { companyId, defaultCompanyId, start, end, outletIds, outletScoped } = scope;
  const brio = await brioCoverage();
  const { brioMonths, monthlyMonths } = splitWindow(start, end, brio);

  type Row = { outlet_id: string | null; company_id: string | null; salary: number; statutory: number };
  const merged = new Map<string, Row>();
  const add = (rows: Row[], factor: number) => {
    for (const r of rows) {
      const key = `${r.outlet_id ?? "NULL"}|${r.company_id ?? "NULL"}`;
      const cur = merged.get(key) ?? { outlet_id: r.outlet_id, company_id: r.company_id, salary: 0, statutory: 0 };
      cur.salary += Number(r.salary) * factor;
      cur.statutory += Number(r.statutory) * factor;
      merged.set(key, cur);
    }
  };

  // BrioHR (authoritative, paid) for the months it covers: the run is a YTD
  // lump, so each covered month is that lump / n, and the window picks up
  // brioMonths.length of them.
  if (brio.n > 0 && brioMonths.length) {
    const brioRows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.preferred_outlet_id AS outlet_id,
             fc.company_id AS company_id,
             COALESCE(SUM(i.total_gross), 0)::float AS salary,
             COALESCE(SUM(i.epf_employer + i.socso_employer + i.eis_employer), 0)::float AS statutory
      FROM hr_payroll_items i
      JOIN hr_payroll_runs r ON r.id = i.payroll_run_id AND r.cycle_type = 'opening_balance'
      LEFT JOIN hr_employee_profiles p ON p.user_id = i.user_id
      LEFT JOIN fin_outlet_companies fc ON fc.outlet_id = p.preferred_outlet_id
      GROUP BY p.preferred_outlet_id, fc.company_id
    `);
    add(brioRows, brioMonths.length / brio.n);
  }

  // Draft monthly runs only for months BrioHR does not cover.
  if (monthlyMonths.length) {
    const monthlyRows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.preferred_outlet_id AS outlet_id,
             fc.company_id AS company_id,
             COALESCE(SUM(i.total_gross), 0)::float AS salary,
             COALESCE(SUM(i.epf_employer + i.socso_employer + i.eis_employer), 0)::float AS statutory
      FROM hr_payroll_items i
      JOIN hr_payroll_runs r ON r.id = i.payroll_run_id AND r.cycle_type = 'monthly'
      LEFT JOIN hr_employee_profiles p ON p.user_id = i.user_id
      LEFT JOIN fin_outlet_companies fc ON fc.outlet_id = p.preferred_outlet_id
      WHERE ${monthListPredicate(monthlyMonths)}
      GROUP BY p.preferred_outlet_id, fc.company_id
    `);
    add(monthlyRows, 1);
  }
  const rows = [...merged.values()];

  let salary = 0;
  let statutory = 0;
  let unassignedSalary = 0;
  let unassignedStatutory = 0;

  for (const r of rows) {
    const isUnassigned = r.outlet_id == null; // no assigned outlet → no company
    if (isUnassigned) {
      // Attributed to the default company at company level, never in an
      // outlet-scoped view (it has no outlet). The consolidated report is the
      // sum of the per-company reports, so it inherits the pool from the
      // default company's report exactly once.
      if (!outletScoped && companyId === defaultCompanyId) {
        unassignedSalary += Number(r.salary);
        unassignedStatutory += Number(r.statutory);
      }
      continue;
    }
    if (outletScoped) {
      // Exact per-outlet split: only this outlet's staff.
      if (outletIds.includes(r.outlet_id!)) {
        salary += Number(r.salary);
        statutory += Number(r.statutory);
      }
      continue;
    }
    // Company view (and each per-company leg of the consolidated build): staff
    // whose assigned outlet maps to this company. Summing the per-company
    // reports gives the group total once, with no cross-entity double count.
    if (r.company_id === companyId) {
      salary += Number(r.salary);
      statutory += Number(r.statutory);
    }
  }

  return {
    salary: round2(salary),
    statutory: round2(statutory),
    unassignedSalary: round2(unassignedSalary),
    unassignedStatutory: round2(unassignedStatutory),
  };
}

// Per-employee payroll rows for the drill, for the given scope and metric.
// metric 'salary' → total_gross; 'statutory' → employer EPF+SOCSO+EIS.
// scopeKind selects which employees are in scope, mirroring peopleCostForScope:
//   'company'     → employees mapping to companyId (assigned outlet)
//   'outlet'      → employees whose preferred_outlet_id is in outletIds
//   'consolidated'→ all assigned employees
//   'unassigned'  → employees with no assigned outlet (default company only)
export type PeopleDrillRow = {
  userId: string;
  name: string | null;
  outletId: string | null;
  year: number;
  month: number;
  amount: number;
};

export async function peopleCostDrill(args: {
  metric: "salary" | "statutory";
  scopeKind: "company" | "outlet" | "consolidated" | "unassigned";
  companyId: string;
  outletIds: string[];
  start: string;
  end: string;
}): Promise<PeopleDrillRow[]> {
  const { metric, scopeKind, companyId, outletIds, start, end } = args;
  const brio = await brioCoverage();
  const { brioMonths, monthlyMonths } = splitWindow(start, end, brio);
  const amountExpr =
    metric === "salary"
      ? Prisma.sql`i.total_gross`
      : Prisma.sql`(i.epf_employer + i.socso_employer + i.eis_employer)`;

  let scopeFilter: Prisma.Sql;
  if (scopeKind === "unassigned") {
    scopeFilter = Prisma.sql`p.preferred_outlet_id IS NULL`;
  } else if (scopeKind === "outlet") {
    if (!outletIds.length) return [];
    scopeFilter = Prisma.sql`p.preferred_outlet_id IN (${Prisma.join(outletIds)})`;
  } else if (scopeKind === "consolidated") {
    scopeFilter = Prisma.sql`p.preferred_outlet_id IS NOT NULL AND fc.company_id IS NOT NULL`;
  } else {
    scopeFilter = Prisma.sql`fc.company_id = ${companyId}`;
  }

  const out: PeopleDrillRow[] = [];

  // BrioHR: one per-employee YTD amount, shown as one row per covered month in
  // window at amount/n (the migration carries no per-month split).
  if (brio.n > 0 && brioMonths.length) {
    const brioRows = await prisma.$queryRaw<{ user_id: string; name: string | null; outlet_id: string | null; amount: number }[]>(Prisma.sql`
      SELECT i.user_id, u.name AS name, p.preferred_outlet_id AS outlet_id, ${amountExpr}::float AS amount
      FROM hr_payroll_items i
      JOIN hr_payroll_runs r ON r.id = i.payroll_run_id AND r.cycle_type = 'opening_balance'
      LEFT JOIN hr_employee_profiles p ON p.user_id = i.user_id
      LEFT JOIN fin_outlet_companies fc ON fc.outlet_id = p.preferred_outlet_id
      LEFT JOIN "User" u ON u.id = i.user_id
      WHERE (${scopeFilter})
      ORDER BY u.name ASC
    `);
    for (const mo of brioMonths) {
      for (const r of brioRows) {
        out.push({ userId: r.user_id, name: r.name, outletId: r.outlet_id, year: mo.year, month: mo.month, amount: round2(Number(r.amount) / brio.n) });
      }
    }
  }

  // Draft monthly runs for the months BrioHR does not cover.
  if (monthlyMonths.length) {
    const rows = await prisma.$queryRaw<{ user_id: string; name: string | null; outlet_id: string | null; year: number; month: number; amount: number }[]>(Prisma.sql`
      SELECT i.user_id, u.name AS name, p.preferred_outlet_id AS outlet_id,
             r.period_year AS year, r.period_month AS month, ${amountExpr}::float AS amount
      FROM hr_payroll_items i
      JOIN hr_payroll_runs r ON r.id = i.payroll_run_id AND r.cycle_type = 'monthly'
      LEFT JOIN hr_employee_profiles p ON p.user_id = i.user_id
      LEFT JOIN fin_outlet_companies fc ON fc.outlet_id = p.preferred_outlet_id
      LEFT JOIN "User" u ON u.id = i.user_id
      WHERE ${monthListPredicate(monthlyMonths)} AND (${scopeFilter})
      ORDER BY r.period_year ASC, r.period_month ASC, u.name ASC
    `);
    for (const r of rows) {
      out.push({ userId: r.user_id, name: r.name, outletId: r.outlet_id, year: Number(r.year), month: Number(r.month), amount: round2(Number(r.amount)) });
    }
  }

  return out.filter((r) => r.amount !== 0);
}
