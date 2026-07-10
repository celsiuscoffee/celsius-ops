// Month-end close preparation — the readiness engine behind the close loop.
//
// For each legal entity and period it answers: is this month ready to close,
// and what would the Close agent post? The checklist is computed live from the
// same sources the reports use, so "all green" genuinely means the month is
// complete:
//
//   1. statements  — bank statements cover the full calendar month
//   2. classified  — zero unclassified bank lines in the month
//   3. payroll     — fin_payroll_actuals loaded for (company, period)
//   4. mgmtFee     — 6.8% of the month's revenue vs what was already paid to
//                    HQ; the shortfall is the accrual the close will post
//                    (DR 6511-06 Management fees / CR 3600-02 Due to HQ)
//   5. depreciation— preview of the straight-line charge for active assets
//
// The management fee base is NET BANK RECEIPTS (sales-channel credits, interco
// excluded) — the same basis the fee has historically been settled on. If the
// policy moves to gross POS sales, change `monthRevenue` in one place here.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getFinanceClient } from "./supabase";

export const MGMT_FEE_RATE = 0.068;
export const MGMT_FEE_EXPENSE_CODE = "6511-06"; // Management fees
export const DUE_TO_HQ_CODE = "3600-02";        // Due to/from Celsius Coffee SB

// Legal entity ↔ Maybank account-number suffix (BankStatement.accountName
// carries "(4384)" etc). HQ (celsius) receives the fee, so it has no accrual.
export const COMPANY_BANK_SUFFIX: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

const SALES_CATEGORIES = [
  "CARD", "QR", "STOREHUB", "GRAB", "GRAB_PUTRAJAYA",
  "FOODPANDA", "MEETINGS_EVENTS", "GASTROHUB", "REVENUE_MONSTER",
];

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CloseCheck = {
  key: "statements" | "classified" | "payroll";
  label: string;
  ok: boolean;
  detail: string;
};

export type ClosePrep = {
  companyId: string;
  companyName: string;
  period: string; // YYYY-MM
  status: "open" | "closing" | "closed";
  checks: CloseCheck[];
  ready: boolean; // every check ok
  mgmtFee: {
    applicable: boolean; // false for HQ
    revenue: number;     // month sales receipts (net, interco excluded)
    accrued: number;     // revenue × 6.8%
    paid: number;        // MANAGEMENT_FEE DR lines in the month
    shortfall: number;   // max(0, accrued − paid) — the journal the close posts
  };
  depreciationPreview: number; // total monthly charge across active assets
};

function monthWindow(period: string): { start: Date; end: Date; startYmd: string; endYmd: string } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return {
    start,
    end,
    startYmd: start.toISOString().slice(0, 10),
    endYmd: end.toISOString().slice(0, 10),
  };
}

// The month's sales receipts + management fee already paid, from the entity's
// own bank lines. One grouped query keeps this cheap for the 3-entity sweep.
async function monthFlows(suffix: string, period: string): Promise<{ revenue: number; feePaid: number; unclassified: number }> {
  const { start, end } = monthWindow(period);
  const rows = await prisma.$queryRaw<{ revenue: number; fee_paid: number; unclassified: number }[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(l.amount) FILTER (
        WHERE l.direction = 'CR' AND l."isInterCo" = false
          AND l.category::text IN (${Prisma.join(SALES_CATEGORIES)})
      ), 0)::float AS revenue,
      COALESCE(SUM(l.amount) FILTER (
        WHERE l.direction = 'DR' AND l.category::text = 'MANAGEMENT_FEE'
      ), 0)::float AS fee_paid,
      COUNT(*) FILTER (WHERE l.category IS NULL)::int AS unclassified
    FROM "BankStatementLine" l
    JOIN "BankStatement" s ON s.id = l."statementId"
    WHERE s."accountName" LIKE ${"%(" + suffix + ")%"}
      AND l."txnDate" >= ${start} AND l."txnDate" <= ${end}
  `);
  const r = rows[0];
  return {
    revenue: round2(Number(r?.revenue ?? 0)),
    feePaid: round2(Number(r?.fee_paid ?? 0)),
    unclassified: Number(r?.unclassified ?? 0),
  };
}

// Statements cover the month when the union of statement periods for the
// entity's account reaches both calendar edges.
async function statementCoverage(suffix: string, period: string): Promise<{ ok: boolean; detail: string }> {
  const { start, end, startYmd, endYmd } = monthWindow(period);
  const stmts = await prisma.bankStatement.findMany({
    where: {
      accountName: { contains: `(${suffix})` },
      periodStart: { lte: end },
      periodEnd: { gte: start },
    },
    select: { periodStart: true, periodEnd: true },
  });
  if (stmts.length === 0) return { ok: false, detail: `No statement covers ${period}` };
  const minStart = stmts.reduce((a, s) => (s.periodStart! < a ? s.periodStart! : a), stmts[0].periodStart!);
  const maxEnd = stmts.reduce((a, s) => (s.periodEnd! > a ? s.periodEnd! : a), stmts[0].periodEnd!);
  const coversStart = minStart.toISOString().slice(0, 10) <= startYmd;
  const coversEnd = maxEnd.toISOString().slice(0, 10) >= endYmd;
  if (coversStart && coversEnd) return { ok: true, detail: `Covered to ${endYmd}` };
  return {
    ok: false,
    detail: coversEnd ? `Starts ${minStart.toISOString().slice(0, 10)}, month start missing` : `Statements end ${maxEnd.toISOString().slice(0, 10)} — upload the rest of ${period}`,
  };
}

async function payrollLoaded(companyId: string, period: string): Promise<{ ok: boolean; detail: string }> {
  const rows = await prisma.$queryRaw<{ n: number; total: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(salary + employer_stat), 0)::float AS total
    FROM fin_payroll_actuals
    WHERE company_id = ${companyId} AND to_char(period, 'YYYY-MM') = ${period}
  `);
  const r = rows[0];
  if (!r || r.n === 0) return { ok: false, detail: "Payroll actuals not loaded (BrioHR ledger)" };
  return { ok: true, detail: `RM ${round2(Number(r.total)).toLocaleString("en-MY")} accrued` };
}

// Straight-line preview: cost/useful_life per active asset, capped at the
// remaining book value — mirrors postDepreciation in agents/close.ts.
async function depreciationPreview(companyId: string): Promise<number> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_fixed_assets")
    .select("cost, useful_life_months, accumulated_dep")
    .eq("company_id", companyId)
    .eq("status", "active");
  let total = 0;
  for (const a of data ?? []) {
    const cost = Number(a.cost);
    const remaining = Math.max(cost - Number(a.accumulated_dep), 0);
    const useful = Number(a.useful_life_months);
    if (remaining <= 0 || useful <= 0) continue;
    total += Math.min(round2(cost / useful), remaining);
  }
  return round2(total);
}

// The management fee accrual the close will post for this entity+period.
// Exported so the Close agent posts exactly what the checklist showed.
export async function mgmtFeeAccrual(companyId: string, period: string): Promise<ClosePrep["mgmtFee"]> {
  const suffix = COMPANY_BANK_SUFFIX[companyId];
  if (!suffix || companyId === "celsius") {
    return { applicable: false, revenue: 0, accrued: 0, paid: 0, shortfall: 0 };
  }
  const { revenue, feePaid } = await monthFlows(suffix, period);
  const accrued = round2(revenue * MGMT_FEE_RATE);
  return {
    applicable: true,
    revenue,
    accrued,
    paid: feePaid,
    shortfall: Math.max(0, round2(accrued - feePaid)),
  };
}

export async function prepareClose(companyId: string, companyName: string, period: string): Promise<ClosePrep> {
  const suffix = COMPANY_BANK_SUFFIX[companyId];
  if (!suffix) throw new Error(`No bank account mapping for company ${companyId}`);

  const client = getFinanceClient();
  const [{ data: periodRow }, coverage, flows, payroll, depPreview] = await Promise.all([
    client.from("fin_periods").select("status").eq("company_id", companyId).eq("period", period).maybeSingle(),
    statementCoverage(suffix, period),
    monthFlows(suffix, period),
    payrollLoaded(companyId, period),
    depreciationPreview(companyId),
  ]);

  const checks: CloseCheck[] = [
    { key: "statements", label: "Bank statements cover the month", ...coverage },
    {
      key: "classified",
      label: "All bank lines classified",
      ok: flows.unclassified === 0,
      detail: flows.unclassified === 0 ? "0 unclassified" : `${flows.unclassified} lines need classification`,
    },
    { key: "payroll", label: "Payroll actuals loaded", ...payroll },
  ];

  const accrued = companyId === "celsius" ? 0 : round2(flows.revenue * MGMT_FEE_RATE);
  const mgmtFee: ClosePrep["mgmtFee"] =
    companyId === "celsius"
      ? { applicable: false, revenue: flows.revenue, accrued: 0, paid: 0, shortfall: 0 }
      : {
          applicable: true,
          revenue: flows.revenue,
          accrued,
          paid: flows.feePaid,
          shortfall: Math.max(0, round2(accrued - flows.feePaid)),
        };

  return {
    companyId,
    companyName,
    period,
    status: (periodRow?.status as ClosePrep["status"]) ?? "open",
    checks,
    ready: checks.every((c) => c.ok),
    mgmtFee,
    depreciationPreview: depPreview,
  };
}
