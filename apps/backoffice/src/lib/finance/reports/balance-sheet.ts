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

// Consolidated mode (companyId = "consolidated"): every account balance is
// summed across all active companies. The 3600 family (inter-company due-to
// and due-from current accounts) is the exception: each entity's balance is a
// mirror of another entity's, so the group figure must NET them. They collapse
// into one "Inter-company balances (net)" line; a net beyond 0.01 is surfaced
// via intercoResidual so the UI can warn that the group books do not fully
// offset. Payroll and statutory controls (3008, 3004 to 3007) sum normally:
// gl-posting-map routes both the accrual and the clearing payment to the same
// account inside the paying company, and cross-company salary funding is
// booked to 3600 (INTERCO_PEOPLE), so they are not cross-company mirrors.

import { getFinanceClient } from "../supabase";
import { pagedJournalLines, pagedPostedTxns } from "./paged";

export const CONSOLIDATED_COMPANY_ID = "consolidated";

const isIntercoCode = (code: string) => code === "3600" || code.startsWith("3600-");

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
  // Consolidated only: net of all 3600-xx inter-company balances across the
  // group. Should be ~0 (due-to in one entity mirrors due-from in another);
  // a residual beyond 0.01 means a leg is missing or misclassified.
  intercoResidual?: number;
};

export type BsInput = {
  companyId: string;
  asOf: string;             // YYYY-MM-DD inclusive
};

export async function buildBalanceSheet(input: BsInput): Promise<BsReport> {
  const client = getFinanceClient();
  const consolidated = input.companyId === CONSOLIDATED_COMPANY_ID;
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

  // Posted txns through asOf. Consolidated = every active company's ledger;
  // summing all their journal lines per account IS the group balance.
  // Paged reads: the ledger outgrew Supabase's 1000-row cap, which silently
  // truncated this walk and made the BS disagree with the TB and GL.
  let companyIds: string[];
  if (consolidated) {
    const { data: cos } = await client
      .from("fin_companies")
      .select("id")
      .eq("is_active", true);
    companyIds = (cos ?? []).map((c) => c.id as string);
  } else {
    companyIds = [input.companyId];
  }
  const { txnIds, txnDate } = await pagedPostedTxns(companyIds, input.asOf);

  const byCode = new Map<string, number>();
  let pnlYtd = 0;     // current fiscal year earnings → synthetic equity line
  let pnlPrior = 0;   // pre-fiscal-year earnings → retained earnings b/f
  // Consolidated: 3600-xx accumulated in raw credit-minus-debit terms (not the
  // per-type display sign), so a due-from booked in one entity offsets the
  // mirrored due-to in another regardless of how each account is typed.
  let intercoNet = 0;

  if (txnIds.length > 0) {
    for await (const lines of pagedJournalLines(txnIds)) {
      for (const l of lines) {
        const code = l.account_code as string;
        const meta = accountMeta.get(code);
        if (!meta) continue;
        const debit = Number(l.debit);
        const credit = Number(l.credit);
        const date = txnDate.get(l.transaction_id as string) ?? "";

        if (consolidated && isIntercoCode(code)) {
          intercoNet += credit - debit;
        } else if (meta.type === "asset" || meta.type === "liability" || meta.type === "equity") {
          const sign = meta.type === "asset" ? debit - credit : credit - debit;
          byCode.set(code, round2((byCode.get(code) ?? 0) + sign));
        } else {
          // Income/cogs/expense accrue to earnings. There are no year-end
          // closing entries in this ledger, so PRIOR-year P&L must roll into
          // retained earnings brought forward — dropping it left the whole of
          // last year's net income out of equity and the BS out of balance by
          // exactly that amount.
          const contribution = meta.type === "income" ? credit - debit : -(debit - credit);
          if (date >= fiscalYearStart && date <= input.asOf) pnlYtd += contribution;
          else pnlPrior += contribution;
        }
      }
    }
  }

  // Consolidated: the 3600-xx due-to/due-from lines collapse to ONE net line.
  // A clean group nets to zero and the line disappears; a residual stays
  // visible (as a liability line, credit-positive) and is flagged so the UI
  // can warn instead of silently absorbing it.
  let intercoResidual: number | undefined;
  if (consolidated) {
    intercoNet = round2(intercoNet);
    intercoResidual = Math.abs(intercoNet) > 0.01 ? intercoNet : 0;
    if (intercoNet !== 0) {
      byCode.set("IC-NET", intercoNet);
      accountMeta.set("IC-NET", {
        name: "Inter-company balances (net)",
        type: "liability",
        parent: null,
      });
    }
  }

  // Inject earnings under equity: prior years brought forward + current year.
  if (pnlPrior !== 0) {
    byCode.set("RE-PRIOR", round2(pnlPrior));
    accountMeta.set("RE-PRIOR", {
      name: "Retained earnings (brought forward)",
      type: "equity",
      parent: null,
    });
  }
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
    ...(consolidated ? { intercoResidual } : {}),
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
