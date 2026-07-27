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
//   5. grabClearing— the Grab debtor (1005) clearing for the month: commission
//                    expensed and, for Conezion, the interco leg for payouts
//                    Grab settles into HQ's bank (see grabClearingForPeriod)
//   6. depreciation— preview of the straight-line charge for active assets
//
// The management fee base is NET BANK RECEIPTS (sales-channel credits, interco
// excluded) — the same basis the fee has historically been settled on. If the
// policy moves to gross POS sales, change `monthRevenue` in one place here.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getFinanceClient } from "./supabase";
import { buildApAccrual } from "./ap-accrual";

export const MGMT_FEE_RATE = 0.068;
export const MGMT_FEE_EXPENSE_CODE = "6511-06"; // Management fees
export const DUE_TO_HQ_CODE = "3600-02";        // Due to/from Celsius Coffee SB
export const MARKETPLACE_FEE_CODE = "6519";     // Grab/FP commission
export const GRAB_DEBTOR_CODE = "1005";         // Grabfood debtors
export const DUE_TO_CONEZION_CODE = "3600-01";  // Due to/from Celsius Coffee Conezion

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

export type GrabClearing = {
  applicable: boolean;     // false when the company booked no Grab gross this month
  gross: number;           // DR 1005 this month (EOD accruals, clearing legs excluded)
  payoutRate: number;      // effective payout rate used (Tamarind trailing actuals)
  commission: number;      // DR 6519 the close posts
  intercoLeg: number;      // Conezion: DR 3600-02 (HQ holds its cash); HQ: CR 3600-01
  exact: boolean;          // false — rate-derived until Grab portal reports are loaded
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
  grabClearing: GrabClearing;
  depreciationPreview: number; // total monthly charge across active assets
  apAccrualPreview: number;    // open supplier bills at period end (Dr expense / Cr 3001), ties to Aged Payables
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

// ─── Grab debtor clearing ────────────────────────────────────────────────
//
// Why this exists: Grab settles Shah Alam, Nilai AND Conezion into HQ's bank
// (4384) as anonymous GPAY credits — no outlet identity on the line, none in
// the webhook payloads, and the Partner API has no settlement endpoint. So
// per-line attribution is impossible; the EOD accrual (Dr 1005 gross) never
// clears for Conezion and commission is expensed nowhere.
//
// The clearing is therefore RATE-DERIVED at month grain: Tamarind's payouts
// land in its OWN bank, so its credits ÷ gross over the trailing 3 closed
// months is the group's real effective payout rate (commission + SST +
// adjustments, observed ≈ 0.66-0.70). Each company's month then clears as:
//
//   Conezion:  Dr 3600-02 payout (HQ holds its cash)
//              Dr 6519 commission (gross − payout)     / Cr 1005 gross
//   HQ:        Dr 1005 / Cr 3600-01 for Conezion's payout (returns the foreign
//              credits its 1005 absorbed), and
//              Dr 6519 / Cr 1005 for its own commission (gross × (1 − rate))
//   Tamarind:  Dr 6519 / Cr 1005 for gross × (1 − rate)
//
// 1005 carries only settlement timing after this, which nets out month to
// month. `exact` stays false — loading Grab portal payment reports later can
// true these up, but the close no longer waits for a human download.

const GRAB_RATE_FALLBACK = 0.68;
const GRAB_RATE_MIN = 0.5;
const GRAB_RATE_MAX = 0.9;

// Gross (DR) and settlement credits (CR) on 1005 for a company+month, from the
// GL, excluding the close's own clearing journals so re-runs see clean inputs.
async function grabDebtorFlows(companyId: string, period: string): Promise<{ gross: number; credits: number }> {
  const rows = await prisma.$queryRaw<{ gross: number; credits: number }[]>(Prisma.sql`
    SELECT COALESCE(SUM(l.debit), 0)::float AS gross,
           COALESCE(SUM(l.credit), 0)::float AS credits
    FROM fin_journal_lines l
    JOIN fin_transactions t ON t.id = l.transaction_id
    WHERE t.company_id = ${companyId}
      AND t.status = 'posted'
      AND t.txn_type <> 'grab_clearing'
      AND l.account_code = ${GRAB_DEBTOR_CODE}
      AND to_char(t.txn_date, 'YYYY-MM') = ${period}
  `);
  return { gross: round2(Number(rows[0]?.gross ?? 0)), credits: round2(Number(rows[0]?.credits ?? 0)) };
}

// Effective payout rate from Tamarind's actuals over the 3 months before the
// period being closed (its Grab money lands in its own bank, so credits/gross
// is the real haircut). Clamped, with a sane fallback for thin months.
export async function grabPayoutRate(period: string): Promise<number> {
  const [y, m] = period.split("-").map(Number);
  const months: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const rows = await prisma.$queryRaw<{ gross: number; credits: number }[]>(Prisma.sql`
    SELECT COALESCE(SUM(l.debit), 0)::float AS gross,
           COALESCE(SUM(l.credit), 0)::float AS credits
    FROM fin_journal_lines l
    JOIN fin_transactions t ON t.id = l.transaction_id
    WHERE t.company_id = 'celsiustamarind'
      AND t.status = 'posted'
      AND t.txn_type <> 'grab_clearing'
      AND l.account_code = ${GRAB_DEBTOR_CODE}
      AND to_char(t.txn_date, 'YYYY-MM') IN (${Prisma.join(months)})
  `);
  const gross = Number(rows[0]?.gross ?? 0);
  const credits = Number(rows[0]?.credits ?? 0);
  if (gross < 1000 || credits <= 0) return GRAB_RATE_FALLBACK;
  return Math.min(GRAB_RATE_MAX, Math.max(GRAB_RATE_MIN, credits / gross));
}

// The Grab clearing the close will post for this entity+period. Exported so
// the Close agent posts exactly what the checklist previewed.
export async function grabClearingForPeriod(companyId: string, period: string): Promise<GrabClearing> {
  const none: GrabClearing = { applicable: false, gross: 0, payoutRate: 0, commission: 0, intercoLeg: 0, exact: false };
  if (!COMPANY_BANK_SUFFIX[companyId]) return none;

  const rate = await grabPayoutRate(period);
  const own = await grabDebtorFlows(companyId, period);

  if (companyId === "celsiusconezion") {
    if (own.gross <= 0) return none;
    const payout = round2(own.gross * rate);
    return {
      applicable: true,
      gross: own.gross,
      payoutRate: round2(rate * 1000) / 1000,
      commission: round2(own.gross - payout),
      intercoLeg: payout, // DR 3600-02 — HQ collected this on Conezion's behalf
      exact: false,
    };
  }

  if (companyId === "celsius") {
    // HQ's 1005 absorbed Conezion's payouts; the interco leg gives them back.
    const conezion = await grabDebtorFlows("celsiusconezion", period);
    const conezionPayout = round2(conezion.gross * rate);
    if (own.gross <= 0 && conezionPayout <= 0) return none;
    return {
      applicable: true,
      gross: own.gross,
      payoutRate: round2(rate * 1000) / 1000,
      commission: round2(own.gross * (1 - rate)),
      intercoLeg: conezionPayout, // CR 3600-01 — owed to Conezion
      exact: false,
    };
  }

  // Tamarind: own-bank settlements already credit 1005; only commission clears.
  if (own.gross <= 0) return none;
  return {
    applicable: true,
    gross: own.gross,
    payoutRate: round2(rate * 1000) / 1000,
    commission: round2(own.gross * (1 - rate)),
    intercoLeg: 0,
    exact: false,
  };
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
  const { endYmd } = monthWindow(period);
  const [{ data: periodRow }, coverage, flows, payroll, depPreview, grabClearing, apAccrual] = await Promise.all([
    client.from("fin_periods").select("status").eq("company_id", companyId).eq("period", period).maybeSingle(),
    statementCoverage(suffix, period),
    monthFlows(suffix, period),
    payrollLoaded(companyId, period),
    depreciationPreview(companyId),
    grabClearingForPeriod(companyId, period),
    buildApAccrual(companyId, endYmd),
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
    grabClearing,
    depreciationPreview: depPreview,
    apAccrualPreview: apAccrual.total,
  };
}
