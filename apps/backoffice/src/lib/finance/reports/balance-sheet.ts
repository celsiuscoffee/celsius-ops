// Balance Sheet generator. Cumulative through asOf date.
//
// Sign convention:
//   assets       — debit balance, displayed positive
//   liabilities  — credit balance, displayed positive
//   equity       — credit balance, displayed positive (incl current-period earnings)
//
// Current-period earnings = income - cogs - expenses YTD up to asOf date,
// surfaced as a synthetic "Retained earnings (current period)" line so the
// equation A = L + E balances even before the close agent sweeps to 4000.

import { getFinanceClient } from "../supabase";

export type BsLine = {
  code: string;
  name: string;
  amount: number;
  parentCode: string | null;
};

export type BsSection = {
  type: "asset" | "liability" | "equity";
  total: number;
  lines: BsLine[];
};

export type BsReport = {
  companyId: string;
  asOf: string;
  fiscalYearStart: string;       // Jan 1 of asOf's year (Malaysia fiscal year = calendar by default)
  assets: BsSection;
  liabilities: BsSection;
  equity: BsSection;
  totalLiabilitiesAndEquity: number;
  // Difference should be zero. Any non-zero amount indicates an imbalance the
  // UI flags loudly (likely an unclosed period or a malformed manual journal).
  imbalance: number;
};

export type BsInput = {
  companyId: string;
  asOf: string;             // YYYY-MM-DD inclusive
};

export async function buildBalanceSheet(input: BsInput): Promise<BsReport> {
  const client = getFinanceClient();
  const fiscalYearStart = `${input.asOf.slice(0, 4)}-01-01`;

  const { data: accounts } = await client
    .from("fin_accounts")
    .select("code, name, type, parent_code")
    .in("type", ["asset", "liability", "equity", "income", "cogs", "expense"]);
  const accountMeta = new Map<string, { name: string; type: string; parent: string | null }>(
    (accounts ?? []).map((a) => [
      a.code as string,
      {
        name: a.name as string,
        type: a.type as string,
        parent: (a.parent_code as string | null) ?? null,
      },
    ])
  );

  // Posted txns through asOf
  const { data: txns } = await client
    .from("fin_transactions")
    .select("id, txn_date")
    .eq("company_id", input.companyId)
    .eq("status", "posted")
    .lte("txn_date", input.asOf);
  const txnIds = (txns ?? []).map((t) => t.id as string);
  const txnDate = new Map((txns ?? []).map((t) => [t.id as string, t.txn_date as string]));

  const byCode = new Map<string, number>();
  let pnlYtd = 0;     // for retained-earnings synthetic line

  if (txnIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < txnIds.length; i += chunkSize) {
      const chunk = txnIds.slice(i, i + chunkSize);
      const { data: lines } = await client
        .from("fin_journal_lines")
        .select("transaction_id, account_code, debit, credit")
        .in("transaction_id", chunk);
      for (const l of lines ?? []) {
        const code = l.account_code as string;
        const meta = accountMeta.get(code);
        if (!meta) continue;
        const debit = Number(l.debit);
        const credit = Number(l.credit);
        const date = txnDate.get(l.transaction_id as string) ?? "";

        if (meta.type === "asset" || meta.type === "liability" || meta.type === "equity") {
          const sign = meta.type === "asset" ? debit - credit : credit - debit;
          byCode.set(code, round2((byCode.get(code) ?? 0) + sign));
        } else if (date >= fiscalYearStart && date <= input.asOf) {
          // Income/cogs/expense — accrue to YTD P&L for retained earnings.
          if (meta.type === "income") pnlYtd += credit - debit;
          else pnlYtd -= debit - credit; // cogs + expense subtract
        }
      }
    }
  }

  // Inject retained earnings (current period) under equity if non-zero.
  if (pnlYtd !== 0) {
    byCode.set("RE-CURRENT", round2(pnlYtd));
    accountMeta.set("RE-CURRENT", {
      name: "Retained earnings (current period)",
      type: "equity",
      parent: null,
    });
  }

  const rolled = rollUp(byCode, accountMeta);

  function buildSection(type: "asset" | "liability" | "equity"): BsSection {
    const lines: BsLine[] = [];
    let total = 0;
    for (const [code, amount] of rolled.entries()) {
      const meta = accountMeta.get(code);
      if (!meta || meta.type !== type) continue;
      if (amount === 0) continue;
      lines.push({ code, name: meta.name, amount: round2(amount), parentCode: meta.parent });
      // Top-level totals: only count root accounts (no parent) to avoid double-counting.
      if (!meta.parent || !accountMeta.get(meta.parent) || accountMeta.get(meta.parent)!.type !== type) {
        // Skipping rolled-up subtotals when summing
      }
    }
    // Total = sum of leaf-level amounts (i.e. byCode pre-rollup) for this type.
    for (const [code, amount] of byCode.entries()) {
      const meta = accountMeta.get(code);
      if (meta?.type === type) total += amount;
    }
    lines.sort((a, b) => a.code.localeCompare(b.code));
    return { type, total: round2(total), lines };
  }

  const assets = buildSection("asset");
  const liabilities = buildSection("liability");
  const equity = buildSection("equity");
  const totalLE = round2(liabilities.total + equity.total);

  return {
    companyId: input.companyId,
    asOf: input.asOf,
    fiscalYearStart,
    assets,
    liabilities,
    equity,
    totalLiabilitiesAndEquity: totalLE,
    imbalance: round2(assets.total - totalLE),
  };
}

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
