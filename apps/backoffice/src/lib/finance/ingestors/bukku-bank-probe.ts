// Bukku live probe — per-token connectivity + mapping check (no IO beyond
// fetch; no prisma/supabase). Kept separate from bukku-bank.ts so it's
// unit-testable under the root runner with a stubbed fetch.
//
// Use after entering a token to confirm the feed works and the mapping looks
// right BEFORE the real sync touches the ledger.

import { mapBukkuTransactions, type BukkuBankTxn, type BukkuListResponse } from "./bukku-bank-map";
import type { BankLineInput } from "./bank-feed-build";

const DEFAULT_BASE_URL = "https://api.bukku.my";

export type BukkuProbe = {
  outlet: string;
  ok: boolean;
  status?: number;
  incomeCount?: number;
  expenseCount?: number;
  sample?: BankLineInput[];
  error?: string;
};

async function probeFetch(
  base: string,
  resource: "incomes" | "expenses",
  token: string,
  from: string,
  to: string
): Promise<{ status: number; txns: BukkuBankTxn[] | null; body?: string }> {
  const url = `${base}/banking/${resource}?date_from=${from}&date_to=${to}&page=1&page_size=5`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) return { status: res.status, txns: null, body: (await res.text()).slice(0, 200) };
  const json = (await res.json()) as BukkuListResponse;
  return { status: 200, txns: json.transactions ?? [] };
}

export async function probeBukkuOutlet(opts: {
  outlet: string;
  token: string;
  from: string;
  to: string;
  baseUrl?: string;
}): Promise<BukkuProbe> {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  try {
    const inc = await probeFetch(base, "incomes", opts.token, opts.from, opts.to);
    if (inc.txns == null) {
      // Auth / API error — surface the status so 401/403 is obvious in the UI.
      return { outlet: opts.outlet, ok: false, status: inc.status, error: inc.body };
    }
    const exp = await probeFetch(base, "expenses", opts.token, opts.from, opts.to);
    const sample = mapBukkuTransactions(inc.txns.slice(0, 2), (exp.txns ?? []).slice(0, 2));
    return {
      outlet: opts.outlet,
      ok: true,
      status: 200,
      incomeCount: inc.txns.length,
      expenseCount: (exp.txns ?? []).length,
      sample,
    };
  } catch (err) {
    return { outlet: opts.outlet, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
