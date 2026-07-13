// People cost (salary + employer statutory) for the sourced P&L, on an ACCRUAL
// basis, sourced from the authoritative BrioHR payroll ledger.
//
// Why not the bank feed: the bank EMPLOYEE_SALARY / STATUTORY_PAYMENT outflows
// are the CASH settlement of payroll. They land when the transfer clears, which
// is usually the following month and split awkwardly across the employer and
// employee legs, so the P&L expense they produced was cash-timed and lagged a
// month. The cost of employing people belongs to the month the work was done.
//
// Source of truth: fin_payroll_actuals, loaded from the BrioHR Payroll Ledger.
// One row per (period, company, outlet) holding that month's gross earnings and
// employer EPF/SOCSO/EIS, tagged to the real outlet, so the per-outlet split is
// the actual assigned cost, not a ratio. HQ rows (outlet_id NULL) are the group
// management payroll, a legitimate entity-level cost of Celsius Coffee SB, shown
// as its own line on the company and consolidated views (never on a single
// outlet). Part-timer wages are NOT here, they stay on the outlet-tagged
// PARTIMER bank lines.
//
// Months with no actuals row yet (2026-07 onward) fall back to the in-house
// 'monthly' hr_payroll runs (draft computations) so the current month still
// shows something until its actuals are loaded.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymFirst = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
const ymKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

// P&L line codes emitted for the two people-cost lines.
export const PEOPLE_SALARY_CODE = "PEOPLE-SALARY";
export const PEOPLE_STAT_CODE = "PEOPLE-STAT";
export const PEOPLE_SALARY_NAME = "Salaries and wages (accrued from payroll)";
export const PEOPLE_STAT_NAME =
  "Statutory contributions, employer EPF/SOCSO/EIS (accrued from payroll)";
// HQ / group-management payroll, an entity-level cost of the default company.
export const PEOPLE_UNASSIGNED_SALARY_NAME = "HQ and management payroll";
export const PEOPLE_UNASSIGNED_STAT_NAME = "HQ and management statutory";

// The [start, end] window as an inclusive list of (year, month).
function monthsInWindow(start: string, end: string): { year: number; month: number }[] {
  const [sy, sm] = start.slice(0, 7).split("-").map(Number);
  const [ey, em] = end.slice(0, 7).split("-").map(Number);
  const out: { year: number; month: number }[] = [];
  let y = sy;
  let m = sm;
  for (let i = 0; i < 240; i++) {
    if (y > ey || (y === ey && m > em)) break;
    out.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// The months (YYYY-MM) that have a fin_payroll_actuals row, so the window can be
// split into actual-covered months and the uncovered tail.
async function actualMonths(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ ym: string }[]>(Prisma.sql`
    SELECT DISTINCT to_char(period, 'YYYY-MM') AS ym FROM fin_payroll_actuals
  `);
  return new Set(rows.map((r) => r.ym));
}

function splitWindow(start: string, end: string, covered: Set<string>) {
  const all = monthsInWindow(start, end);
  return {
    actualMos: all.filter((mo) => covered.has(ymKey(mo.year, mo.month))),
    draftMos: all.filter((mo) => !covered.has(ymKey(mo.year, mo.month))),
  };
}

// Draft monthly-run predicate for the uncovered tail.
function monthListPredicate(months: { year: number; month: number }[]): Prisma.Sql {
  if (!months.length) return Prisma.sql`FALSE`;
  const tuples = months.map((mo) => Prisma.sql`(${mo.year}, ${mo.month})`);
  return Prisma.sql`(r.period_year, r.period_month) IN (${Prisma.join(tuples)})`;
}

export type PeopleCostScope = {
  companyId: string;        // the company the P&L is being built for
  defaultCompanyId: string; // where HQ / management payroll is attributed
  start: string;
  end: string;
  outletIds: string[];      // the company's outlets, or one when scoped to an outlet
  outletScoped: boolean;    // true when the P&L is a single-outlet view
  consolidated: boolean;    // kept for signature symmetry
};

export type PeopleCostResult = {
  salary: number;            // assigned (outlet) salary for this scope
  statutory: number;         // assigned (outlet) employer statutory for this scope
  unassignedSalary: number;  // HQ / management pool, when it applies to this scope
  unassignedStatutory: number;
};

// Aggregate people cost for a P&L scope from fin_payroll_actuals (covered
// months) plus the draft monthly runs (uncovered tail), bucketed by outlet and
// company:
//   - outlet-scoped view: only rows whose outlet_id is in scope; HQ excluded.
//   - company view: rows whose company_id is this company; the HQ (null-outlet)
//     rows for the default company surface as the HQ pool.
//   - consolidated: each company summed once, plus the HQ pool via the default
//     company's leg.
export async function peopleCostForScope(scope: PeopleCostScope): Promise<PeopleCostResult> {
  const { companyId, defaultCompanyId, start, end, outletIds, outletScoped } = scope;
  const { actualMos, draftMos } = splitWindow(start, end, await actualMonths());

  type Row = { outlet_id: string | null; company_id: string | null; salary: number; statutory: number };
  const merged = new Map<string, Row>();
  const add = (rows: Row[]) => {
    for (const r of rows) {
      const key = `${r.outlet_id ?? "NULL"}|${r.company_id ?? "NULL"}`;
      const cur = merged.get(key) ?? { outlet_id: r.outlet_id, company_id: r.company_id, salary: 0, statutory: 0 };
      cur.salary += Number(r.salary);
      cur.statutory += Number(r.statutory);
      merged.set(key, cur);
    }
  };

  // Authoritative actuals for the months they cover.
  if (actualMos.length) {
    const periods = actualMos.map((mo) => ymFirst(mo.year, mo.month));
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT outlet_id, company_id,
             COALESCE(SUM(salary), 0)::float AS salary,
             COALESCE(SUM(employer_stat), 0)::float AS statutory
      FROM fin_payroll_actuals
      WHERE period IN (${Prisma.join(periods.map((p) => Prisma.sql`${p}::date`))})
      GROUP BY outlet_id, company_id
    `);
    add(rows);
  }

  // Draft monthly runs for the uncovered tail (per-employee, attributed via the
  // employee's assigned outlet). No outlet -> HQ pool via the default company.
  if (draftMos.length) {
    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT p.preferred_outlet_id AS outlet_id,
             fc.company_id AS company_id,
             COALESCE(SUM(i.total_gross), 0)::float AS salary,
             COALESCE(SUM(i.epf_employer + i.socso_employer + i.eis_employer), 0)::float AS statutory
      FROM hr_payroll_items i
      JOIN hr_payroll_runs r ON r.id = i.payroll_run_id AND r.cycle_type = 'monthly'
      LEFT JOIN hr_employee_profiles p ON p.user_id = i.user_id
      LEFT JOIN fin_outlet_companies fc ON fc.outlet_id = p.preferred_outlet_id
      WHERE ${monthListPredicate(draftMos)}
      GROUP BY p.preferred_outlet_id, fc.company_id
    `);
    add(rows);
  }

  let salary = 0;
  let statutory = 0;
  let unassignedSalary = 0;
  let unassignedStatutory = 0;

  for (const r of merged.values()) {
    const isHq = r.outlet_id == null; // HQ / management, no outlet
    if (isHq) {
      // Entity-level management cost, attributed to the default company on the
      // company and consolidated views, never on a single-outlet view.
      if (!outletScoped && companyId === defaultCompanyId) {
        unassignedSalary += Number(r.salary);
        unassignedStatutory += Number(r.statutory);
      }
      continue;
    }
    if (outletScoped) {
      if (outletIds.includes(r.outlet_id!)) {
        salary += Number(r.salary);
        statutory += Number(r.statutory);
      }
      continue;
    }
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

// Per-line rows for the people-cost drill.
export type PeopleDrillRow = {
  userId: string;       // outlet id for actuals rows, user id for draft rows
  name: string | null;  // outlet label (actuals) or employee name (draft)
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
  const { actualMos, draftMos } = splitWindow(start, end, await actualMonths());
  const out: PeopleDrillRow[] = [];

  // Actuals months: per-EMPLOYEE rows from the payroll items, reconciled to
  // the ledger. The P&L line is the fin_payroll_actuals aggregate (the BrioHR
  // ledger), but the ledger is outlet-grain, so the staff detail comes from
  // hr_payroll_items. Items are only shown under (outlet, month) cells the
  // ledger actually covers, and any difference between the ledger figure and
  // the items' sum is emitted as one "BrioHR ledger adjustment" row per cell,
  // so the drill total always ties to the line. Cells with no items at all
  // fall back to the single outlet-label row (previous behaviour).
  if (actualMos.length) {
    const periods = actualMos.map((mo) => ymFirst(mo.year, mo.month));
    const amountCol = metric === "salary" ? Prisma.sql`salary` : Prisma.sql`employer_stat`;
    let filter: Prisma.Sql;
    if (scopeKind === "unassigned") filter = Prisma.sql`outlet_id IS NULL`;
    else if (scopeKind === "outlet") {
      if (!outletIds.length) filter = Prisma.sql`FALSE`;
      else filter = Prisma.sql`outlet_id IN (${Prisma.join(outletIds)})`;
    } else if (scopeKind === "consolidated") filter = Prisma.sql`outlet_id IS NOT NULL`;
    else filter = Prisma.sql`company_id = ${companyId} AND outlet_id IS NOT NULL`;

    const aggRows = await prisma.$queryRaw<{ outlet_id: string | null; label: string | null; period: Date; amount: number }[]>(Prisma.sql`
      SELECT outlet_id, outlet_label AS label, period, ${amountCol}::float AS amount
      FROM fin_payroll_actuals
      WHERE period IN (${Prisma.join(periods.map((p) => Prisma.sql`${p}::date`))}) AND (${filter})
      ORDER BY period ASC, outlet_label ASC
    `);

    // Per-employee items for the same months, same scope shape as the draft
    // branch (attribution via the employee's assigned outlet).
    const amountExpr = metric === "salary"
      ? Prisma.sql`i.total_gross`
      : Prisma.sql`(i.epf_employer + i.socso_employer + i.eis_employer)`;
    let itemScope: Prisma.Sql;
    if (scopeKind === "unassigned") itemScope = Prisma.sql`p.preferred_outlet_id IS NULL`;
    else if (scopeKind === "outlet") {
      if (!outletIds.length) itemScope = Prisma.sql`FALSE`;
      else itemScope = Prisma.sql`p.preferred_outlet_id IN (${Prisma.join(outletIds)})`;
    } else if (scopeKind === "consolidated") itemScope = Prisma.sql`p.preferred_outlet_id IS NOT NULL AND fc.company_id IS NOT NULL`;
    else itemScope = Prisma.sql`fc.company_id = ${companyId} AND p.preferred_outlet_id IS NOT NULL`;

    const itemRows = await prisma.$queryRaw<{ user_id: string; name: string | null; outlet_id: string | null; year: number; month: number; amount: number }[]>(Prisma.sql`
      SELECT i.user_id, u.name AS name, p.preferred_outlet_id AS outlet_id,
             r.period_year AS year, r.period_month AS month, ${amountExpr}::float AS amount
      FROM hr_payroll_items i
      JOIN hr_payroll_runs r ON r.id = i.payroll_run_id AND r.cycle_type = 'monthly'
      LEFT JOIN hr_employee_profiles p ON p.user_id = i.user_id
      LEFT JOIN fin_outlet_companies fc ON fc.outlet_id = p.preferred_outlet_id
      LEFT JOIN "User" u ON u.id = i.user_id
      WHERE ${monthListPredicate(actualMos)} AND (${itemScope})
      ORDER BY r.period_year ASC, r.period_month ASC, u.name ASC
    `);

    const cellKey = (outletId: string | null, year: number, month: number) =>
      `${outletId ?? "NULL"}|${ymKey(year, month)}`;
    const coveredCells = new Set(
      aggRows.map((r) => cellKey(r.outlet_id, r.period.getUTCFullYear(), r.period.getUTCMonth() + 1)),
    );
    const itemSumByCell = new Map<string, number>();
    for (const r of itemRows) {
      const key = cellKey(r.outlet_id, Number(r.year), Number(r.month));
      // Employees outside the ledger's cells are not part of the P&L line —
      // showing them would break the tie to the statement.
      if (!coveredCells.has(key)) continue;
      const amount = round2(Number(r.amount));
      itemSumByCell.set(key, round2((itemSumByCell.get(key) ?? 0) + amount));
      out.push({ userId: r.user_id, name: r.name, outletId: r.outlet_id, year: Number(r.year), month: Number(r.month), amount });
    }

    for (const r of aggRows) {
      const year = r.period.getUTCFullYear();
      const month = r.period.getUTCMonth() + 1;
      const key = cellKey(r.outlet_id, year, month);
      const ledger = round2(Number(r.amount));
      const itemsSum = itemSumByCell.get(key);
      if (itemsSum == null) {
        // No staff detail for this cell — keep the outlet-lump row.
        out.push({ userId: r.outlet_id ?? "HQ", name: r.label, outletId: r.outlet_id, year, month, amount: ledger });
        continue;
      }
      const delta = round2(ledger - itemsSum);
      if (Math.abs(delta) >= 0.01) {
        out.push({ userId: `adj-${key}`, name: "BrioHR ledger adjustment", outletId: r.outlet_id, year, month, amount: delta });
      }
    }
  }

  // Draft monthly runs for the uncovered tail: per employee per month.
  if (draftMos.length) {
    const amountExpr = metric === "salary"
      ? Prisma.sql`i.total_gross`
      : Prisma.sql`(i.epf_employer + i.socso_employer + i.eis_employer)`;
    let scopeFilter: Prisma.Sql;
    if (scopeKind === "unassigned") scopeFilter = Prisma.sql`p.preferred_outlet_id IS NULL`;
    else if (scopeKind === "outlet") {
      if (!outletIds.length) scopeFilter = Prisma.sql`FALSE`;
      else scopeFilter = Prisma.sql`p.preferred_outlet_id IN (${Prisma.join(outletIds)})`;
    } else if (scopeKind === "consolidated") scopeFilter = Prisma.sql`p.preferred_outlet_id IS NOT NULL AND fc.company_id IS NOT NULL`;
    else scopeFilter = Prisma.sql`fc.company_id = ${companyId}`;

    const rows = await prisma.$queryRaw<{ user_id: string; name: string | null; outlet_id: string | null; year: number; month: number; amount: number }[]>(Prisma.sql`
      SELECT i.user_id, u.name AS name, p.preferred_outlet_id AS outlet_id,
             r.period_year AS year, r.period_month AS month, ${amountExpr}::float AS amount
      FROM hr_payroll_items i
      JOIN hr_payroll_runs r ON r.id = i.payroll_run_id AND r.cycle_type = 'monthly'
      LEFT JOIN hr_employee_profiles p ON p.user_id = i.user_id
      LEFT JOIN fin_outlet_companies fc ON fc.outlet_id = p.preferred_outlet_id
      LEFT JOIN "User" u ON u.id = i.user_id
      WHERE ${monthListPredicate(draftMos)} AND (${scopeFilter})
      ORDER BY r.period_year ASC, r.period_month ASC, u.name ASC
    `);
    for (const r of rows) {
      out.push({ userId: r.user_id, name: r.name, outletId: r.outlet_id, year: Number(r.year), month: Number(r.month), amount: round2(Number(r.amount)) });
    }
  }

  return out.filter((r) => r.amount !== 0);
}
