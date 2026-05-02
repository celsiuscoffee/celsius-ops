// Cash Flow statement — indirect method.
//
// Operating activities  = net income
//                       + non-cash add-backs (depreciation 6512)
//                       + working-capital changes (∆ AR, ∆ AP, ∆ Inventory, ...)
// Investing activities  = ∆ PP&E (1500), exclude acc dep
// Financing activities  = ∆ Loans (3010, 3500, 3400), ∆ Equity (4001)
//
// Net change in cash    = ∆ on bank accounts (1000-*)
// Reconciliation: operating + investing + financing should ≈ net change in cash.

import { getFinanceClient } from "../supabase";

export type CfSection = {
  title: string;
  lines: Array<{ label: string; amount: number; code?: string }>;
  total: number;
};

export type CfReport = {
  companyId: string;
  start: string;
  end: string;
  netIncome: number;
  operating: CfSection;
  investing: CfSection;
  financing: CfSection;
  netChangeInCash: number;
  cashAtStart: number;
  cashAtEnd: number;
  reconciliationGap: number;
};

export type CfInput = {
  companyId: string;
  start: string;
  end: string;
};

// Compute the closing balance for a code as of a given date (debit-positive
// for asset/expense/cogs accounts, credit-positive for the rest).
async function balanceFor(
  companyId: string,
  codePrefix: string,
  asOfDate: string,
  signMode: "debit" | "credit"
): Promise<number> {
  const client = getFinanceClient();
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "posted")
    .lte("txn_date", asOfDate);
  const txnIds = (txns ?? []).map((t) => t.id as string);
  if (txnIds.length === 0) return 0;

  let total = 0;
  const chunkSize = 200;
  for (let i = 0; i < txnIds.length; i += chunkSize) {
    const chunk = txnIds.slice(i, i + chunkSize);
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("account_code, debit, credit")
      .in("transaction_id", chunk)
      .like("account_code", `${codePrefix}%`);
    for (const l of lines ?? []) {
      total +=
        signMode === "debit"
          ? Number(l.debit) - Number(l.credit)
          : Number(l.credit) - Number(l.debit);
    }
  }
  return round2(total);
}

async function rangeMovement(
  companyId: string,
  codePrefix: string,
  start: string,
  end: string,
  signMode: "debit" | "credit"
): Promise<number> {
  // Movement = balanceFor(end) - balanceFor(start - 1 day)
  const dayBefore = oneDayBefore(start);
  const closing = await balanceFor(companyId, codePrefix, end, signMode);
  const opening = await balanceFor(companyId, codePrefix, dayBefore, signMode);
  return round2(closing - opening);
}

export async function buildCashFlow(input: CfInput): Promise<CfReport> {
  const dayBefore = oneDayBefore(input.start);

  // Net income for the range — re-compute from journals to match P&L exactly.
  const netIncome = await rangeMovement(input.companyId, "5", input.start, input.end, "credit")
    - await rangeMovement(input.companyId, "6000", input.start, input.end, "debit")
    - await rangeMovement(input.companyId, "6001", input.start, input.end, "debit")
    - await rangeMovement(input.companyId, "6002", input.start, input.end, "debit")
    - await rangeMovement(input.companyId, "6003", input.start, input.end, "debit")
    - await rangeMovement(input.companyId, "65", input.start, input.end, "debit")
    - await rangeMovement(input.companyId, "69", input.start, input.end, "debit");

  // Depreciation add-back
  const depreciation = await rangeMovement(input.companyId, "6512", input.start, input.end, "debit");

  // Working capital changes (signs flipped: increase in asset = use of cash;
  // increase in liability = source of cash)
  const deltaAr = -await rangeMovement(input.companyId, "1001", input.start, input.end, "debit");
  const deltaInventory = -await rangeMovement(input.companyId, "1002", input.start, input.end, "debit");
  const deltaPrepay = -await rangeMovement(input.companyId, "1003", input.start, input.end, "debit");
  const deltaAp = await rangeMovement(input.companyId, "3001", input.start, input.end, "credit");
  const deltaSstPayable = await rangeMovement(input.companyId, "3002", input.start, input.end, "credit");
  const deltaPayrollControls =
    await rangeMovement(input.companyId, "3004", input.start, input.end, "credit") +
    await rangeMovement(input.companyId, "3005", input.start, input.end, "credit") +
    await rangeMovement(input.companyId, "3006", input.start, input.end, "credit") +
    await rangeMovement(input.companyId, "3007", input.start, input.end, "credit") +
    await rangeMovement(input.companyId, "3008", input.start, input.end, "credit");

  const operating: CfSection = {
    title: "Operating",
    lines: [
      { label: "Net income", amount: round2(netIncome) },
      { label: "Depreciation", amount: round2(depreciation), code: "6512" },
      { label: "∆ Accounts receivable", amount: round2(deltaAr), code: "1001" },
      { label: "∆ Inventory", amount: round2(deltaInventory), code: "1002" },
      { label: "∆ Deposits & prepayments", amount: round2(deltaPrepay), code: "1003" },
      { label: "∆ Accounts payable", amount: round2(deltaAp), code: "3001" },
      { label: "∆ SST payable", amount: round2(deltaSstPayable), code: "3002" },
      { label: "∆ Payroll controls", amount: round2(deltaPayrollControls) },
    ],
    total: 0,
  };
  operating.total = round2(operating.lines.reduce((s, l) => s + l.amount, 0));

  // Investing = ∆ PP&E (capex). Negative = cash spent on PP&E.
  const deltaPpe = -await rangeMovement(input.companyId, "1500", input.start, input.end, "debit");
  const investing: CfSection = {
    title: "Investing",
    lines: [{ label: "∆ Property, Plant & Equipment", amount: round2(deltaPpe), code: "1500" }],
    total: round2(deltaPpe),
  };

  // Financing = ∆ loans + ∆ equity contributions
  const deltaShortLoan = await rangeMovement(input.companyId, "3010", input.start, input.end, "credit");
  const deltaLongLoan = await rangeMovement(input.companyId, "3500", input.start, input.end, "credit");
  const deltaDirectorLoan = await rangeMovement(input.companyId, "3400", input.start, input.end, "credit");
  const deltaCapital = await rangeMovement(input.companyId, "4001", input.start, input.end, "credit");

  const financing: CfSection = {
    title: "Financing",
    lines: [
      { label: "∆ Short-term loans", amount: round2(deltaShortLoan), code: "3010" },
      { label: "∆ Long-term loans", amount: round2(deltaLongLoan), code: "3500" },
      { label: "∆ Due to directors", amount: round2(deltaDirectorLoan), code: "3400" },
      { label: "∆ Owner capital", amount: round2(deltaCapital), code: "4001" },
    ],
    total: 0,
  };
  financing.total = round2(financing.lines.reduce((s, l) => s + l.amount, 0));

  const cashAtStart = await balanceFor(input.companyId, "1000", dayBefore, "debit");
  const cashAtEnd = await balanceFor(input.companyId, "1000", input.end, "debit");
  const netChange = round2(cashAtEnd - cashAtStart);
  const computed = round2(operating.total + investing.total + financing.total);

  return {
    companyId: input.companyId,
    start: input.start,
    end: input.end,
    netIncome: round2(netIncome),
    operating,
    investing,
    financing,
    netChangeInCash: netChange,
    cashAtStart: round2(cashAtStart),
    cashAtEnd: round2(cashAtEnd),
    reconciliationGap: round2(computed - netChange),
  };
}

function oneDayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
