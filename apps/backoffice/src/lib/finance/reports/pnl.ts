// Profit & Loss report generator. Always live — pulls posted journals for
// the requested company + period. Returns hierarchical structure (parent
// account → children → lines) so the UI can render and drill down.
//
// Sign convention: income shown as positive (credit balance), cogs/expense
// shown as positive (debit balance), so subtraction works naturally:
//   income - cogs = gross profit
//   gross profit - expenses = net income
//
// Period can be a single month "YYYY-MM" or a range. Year-to-date and
// quarter use the range form.

import { getFinanceClient } from "../supabase";

export type PnlLine = {
  code: string;
  name: string;
  amount: number;
  parentCode: string | null;
};

export type PnlSection = {
  type: "income" | "cogs" | "expense";
  total: number;
  lines: PnlLine[];
};

export type PnlReport = {
  companyId: string;
  start: string;
  end: string;
  income: PnlSection;
  cogs: PnlSection;
  grossProfit: number;
  expenses: PnlSection;
  netIncome: number;
  txnCount: number;
};

export type PnlInput = {
  companyId: string;
  start: string;             // YYYY-MM-DD inclusive
  end: string;               // YYYY-MM-DD inclusive
};

export async function buildPnl(input: PnlInput): Promise<PnlReport> {
  const client = getFinanceClient();

  // Load every account in P&L scope, with name + parent for hierarchical render.
  const { data: accounts } = await client
    .from("fin_accounts")
    .select("code, name, type, parent_code")
    .in("type", ["income", "cogs", "expense"]);
  const accountMeta = new Map(
    (accounts ?? []).map((a) => [
      a.code as string,
      { name: a.name as string, type: a.type as string, parent: (a.parent_code as string) ?? null },
    ])
  );

  // Posted txns in range for this company.
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("status", "posted")
    .gte("txn_date", input.start)
    .lte("txn_date", input.end);
  const txnIds = (txns ?? []).map((t) => t.id as string);

  const byCode = new Map<string, number>();
  let totalIncome = 0;
  let totalCogs = 0;
  let totalExpenses = 0;

  if (txnIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < txnIds.length; i += chunkSize) {
      const chunk = txnIds.slice(i, i + chunkSize);
      const { data: lines } = await client
        .from("fin_journal_lines")
        .select("account_code, debit, credit")
        .in("transaction_id", chunk);
      for (const l of lines ?? []) {
        const code = l.account_code as string;
        const meta = accountMeta.get(code);
        if (!meta) continue;
        const sign =
          meta.type === "income"
            ? Number(l.credit) - Number(l.debit)
            : Number(l.debit) - Number(l.credit);
        byCode.set(code, round2((byCode.get(code) ?? 0) + sign));
        if (meta.type === "income") totalIncome += sign;
        else if (meta.type === "cogs") totalCogs += sign;
        else if (meta.type === "expense") totalExpenses += sign;
      }
    }
  }

  // Roll up children into parents so the report shows non-zero parents
  // even if the parent code never received a direct posting.
  const rolled = rollUp(byCode, accountMeta);

  function buildSection(type: "income" | "cogs" | "expense", total: number): PnlSection {
    const lines: PnlLine[] = [];
    for (const [code, amount] of rolled.entries()) {
      const meta = accountMeta.get(code);
      if (!meta || meta.type !== type) continue;
      if (amount === 0) continue;
      lines.push({
        code,
        name: meta.name,
        amount: round2(amount),
        parentCode: meta.parent,
      });
    }
    lines.sort((a, b) => a.code.localeCompare(b.code));
    return { type, total: round2(total), lines };
  }

  return {
    companyId: input.companyId,
    start: input.start,
    end: input.end,
    income: buildSection("income", totalIncome),
    cogs: buildSection("cogs", totalCogs),
    grossProfit: round2(totalIncome - totalCogs),
    expenses: buildSection("expense", totalExpenses),
    netIncome: round2(totalIncome - totalCogs - totalExpenses),
    txnCount: txnIds.length,
  };
}

// Add child amounts onto each ancestor account so parents reflect the full
// subtree. Returns a new map; doesn't mutate the input.
function rollUp(
  byCode: Map<string, number>,
  meta: Map<string, { name: string; type: string; parent: string | null }>
): Map<string, number> {
  const out = new Map(byCode);
  for (const [code, amount] of byCode.entries()) {
    let parent = meta.get(code)?.parent;
    while (parent) {
      out.set(parent, round2((out.get(parent) ?? 0) + amount));
      parent = meta.get(parent)?.parent ?? null;
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Drill-down: return the journals that contributed to a given account_code
// in the period. Used by the UI when the user clicks a line.
export async function pnlDrillDown(args: {
  companyId: string;
  accountCode: string;
  start: string;
  end: string;
}): Promise<
  Array<{
    transactionId: string;
    txnDate: string;
    description: string;
    amount: number;
    debit: number;
    credit: number;
  }>
> {
  const client = getFinanceClient();
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id, txn_date, description, amount")
    .eq("company_id", args.companyId)
    .eq("status", "posted")
    .gte("txn_date", args.start)
    .lte("txn_date", args.end);
  const txnIds = (txns ?? []).map((t) => t.id as string);
  if (txnIds.length === 0) return [];
  const txnMap = new Map((txns ?? []).map((t) => [t.id as string, t]));

  const results: Array<{
    transactionId: string;
    txnDate: string;
    description: string;
    amount: number;
    debit: number;
    credit: number;
  }> = [];

  const chunkSize = 200;
  for (let i = 0; i < txnIds.length; i += chunkSize) {
    const chunk = txnIds.slice(i, i + chunkSize);
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("transaction_id, debit, credit")
      .in("transaction_id", chunk)
      .eq("account_code", args.accountCode);
    for (const l of lines ?? []) {
      const t = txnMap.get(l.transaction_id as string);
      if (!t) continue;
      results.push({
        transactionId: l.transaction_id as string,
        txnDate: t.txn_date as string,
        description: t.description as string,
        amount: Number(t.amount),
        debit: Number(l.debit),
        credit: Number(l.credit),
      });
    }
  }
  return results.sort((a, b) => b.txnDate.localeCompare(a.txnDate));
}
