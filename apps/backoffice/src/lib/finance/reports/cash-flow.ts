// Cash Flow statement — indirect method, built so it TIES BY CONSTRUCTION.
//
// Every posted journal line hits either a cash account (1000-*) or something
// else; since debits always equal credits, the cash movement of the period is
// exactly the sum of (credit − debit) over every NON-cash account. So instead
// of enumerating a fixed list of accounts (the old builder missed Suspense,
// channel debtors, inter-company and dividends — everything it missed became
// an unexplained "reconciliation gap"), this walks the ledger once, buckets
// every non-cash account into a named line, and sweeps the remainder into an
// explicit "Other movements" line. The gap can then only be rounding.
//
// Operating  = net income (all 5*/6* accounts, depreciation stays inside)
//            + working-capital deltas + channel-debtor settlements + Suspense
// Investing  = ∆ PP&E net (1500*, accumulated depreciation included)
// Financing  = ∆ loans (3010/3500/3400) + inter-company (3600*)
//            + owner capital & dividends (4*)
//
// Net change in cash = ∆ on 1000-* accounts.

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

// Which named line a non-cash account belongs to. First match wins.
type BucketKey =
  | "pnl" | "ar" | "inventory" | "prepay" | "channelDebtors" | "suspense"
  | "ap" | "sst" | "payroll" | "otherOperating"
  | "ppe"
  | "shortLoan" | "longLoan" | "directors" | "interco" | "equity";

function bucketFor(code: string): BucketKey {
  if (code.startsWith("5") || code.startsWith("6")) return "pnl";
  if (code === "1001" || code.startsWith("1001-")) return "ar";
  if (code === "1002" || code.startsWith("1002-")) return "inventory";
  if (code === "1003" || code.startsWith("1003-")) return "prepay";
  if (code === "1005" || code === "1006" || code === "1007" || code.startsWith("1005-") || code.startsWith("1006-") || code.startsWith("1007-")) return "channelDebtors";
  if (code === "1999") return "suspense";
  if (code === "3001" || code.startsWith("3001-")) return "ap";
  if (code === "3002" || code.startsWith("3002-")) return "sst";
  if (code >= "3004" && code <= "3008") return "payroll";
  if (code.startsWith("3004") || code.startsWith("3005") || code.startsWith("3006") || code.startsWith("3007") || code.startsWith("3008")) return "payroll";
  if (code.startsWith("1500")) return "ppe";
  if (code === "3010" || code.startsWith("3010-")) return "shortLoan";
  if (code.startsWith("3500")) return "longLoan";
  if (code.startsWith("3400")) return "directors";
  if (code.startsWith("3600")) return "interco";
  if (code.startsWith("4")) return "equity";
  return "otherOperating"; // any 1xxx/2xxx/3xxx not named above
}

export async function buildCashFlow(input: CfInput): Promise<CfReport> {
  const client = getFinanceClient();
  const dayBefore = oneDayBefore(input.start);

  // One ledger walk: every posted txn through the period end.
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id, txn_date")
    .eq("company_id", input.companyId)
    .eq("status", "posted")
    .lte("txn_date", input.end);
  const txnDate = new Map((txns ?? []).map((t) => [t.id as string, t.txn_date as string]));
  const txnIds = [...txnDate.keys()];

  let cashAtStart = 0;
  let cashAtEnd = 0;
  const flows = new Map<BucketKey, number>(); // (credit − debit) per bucket, in-range only

  for (let i = 0; i < txnIds.length; i += 200) {
    const chunk = txnIds.slice(i, i + 200);
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("transaction_id, account_code, debit, credit")
      .in("transaction_id", chunk);
    for (const l of lines ?? []) {
      const date = txnDate.get(l.transaction_id as string) ?? "";
      const code = l.account_code as string;
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      if (code.startsWith("1000")) {
        const mov = debit - credit;
        if (date <= dayBefore) cashAtStart += mov;
        cashAtEnd += mov;
        continue;
      }
      if (date < input.start || date > input.end) continue;
      // Cash-flow contribution of a non-cash account: credit = source of
      // cash (+), debit = use of cash (−) — for every account type.
      const b = bucketFor(code);
      flows.set(b, (flows.get(b) ?? 0) + (credit - debit));
    }
  }

  const f = (k: BucketKey) => round2(flows.get(k) ?? 0);
  const netIncome = f("pnl");

  const operating: CfSection = {
    title: "Operating",
    lines: [
      { label: "Net income (depreciation included)", amount: netIncome },
      { label: "∆ Accounts receivable", amount: f("ar"), code: "1001" },
      { label: "∆ Inventory", amount: f("inventory"), code: "1002" },
      { label: "∆ Deposits & prepayments", amount: f("prepay"), code: "1003" },
      { label: "∆ Channel debtors (card / Grab settlements)", amount: f("channelDebtors"), code: "1005-1007" },
      { label: "∆ Accounts payable", amount: f("ap"), code: "3001" },
      { label: "∆ SST payable", amount: f("sst"), code: "3002" },
      { label: "∆ Payroll controls", amount: f("payroll"), code: "3004-3008" },
      { label: "Unreconciled inflows (Suspense)", amount: f("suspense"), code: "1999" },
      { label: "Other movements", amount: f("otherOperating") },
    ].filter((l) => l.amount !== 0 || l.label.startsWith("Net income")),
    total: 0,
  };
  operating.total = round2(operating.lines.reduce((s, l) => s + l.amount, 0));

  const investing: CfSection = {
    title: "Investing",
    lines: [{ label: "∆ Property, Plant & Equipment (net)", amount: f("ppe"), code: "1500" }],
    total: f("ppe"),
  };

  const financing: CfSection = {
    title: "Financing",
    lines: [
      { label: "∆ Short-term loans", amount: f("shortLoan"), code: "3010" },
      { label: "∆ Long-term loans", amount: f("longLoan"), code: "3500" },
      { label: "∆ Due to directors", amount: f("directors"), code: "3400" },
      { label: "∆ Inter-company balances", amount: f("interco"), code: "3600" },
      { label: "Owner capital & dividends", amount: f("equity"), code: "4xxx" },
    ].filter((l) => l.amount !== 0),
    total: 0,
  };
  financing.total = round2(financing.lines.reduce((s, l) => s + l.amount, 0));

  cashAtStart = round2(cashAtStart);
  cashAtEnd = round2(cashAtEnd);
  const netChange = round2(cashAtEnd - cashAtStart);
  const computed = round2(operating.total + investing.total + financing.total);

  return {
    companyId: input.companyId,
    start: input.start,
    end: input.end,
    netIncome,
    operating,
    investing,
    financing,
    netChangeInCash: netChange,
    cashAtStart,
    cashAtEnd,
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
