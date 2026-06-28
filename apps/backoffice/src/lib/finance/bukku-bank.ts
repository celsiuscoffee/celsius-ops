// Bukku Bank API client + mappers.
//
// Pulls the bank ledger from Bukku's Bank API instead of (or alongside)
// our Maybank PDF parser. Three list endpoints supply the lines and the
// /accounts endpoint supplies the balance we anchor the daily-balance
// reconstruction on:
//
//   GET /banking/incomes   → Money In  (deposits/receipts)  → CR
//   GET /banking/expenses  → Money Out (payments)           → DR
//   GET /banking/transfers → Transfers (account ↔ account)  → DR(from)+CR(to)
//   GET /accounts          → COA accounts incl. current `balance`
//
// Each record already carries the COA account it hit (account_code like
// "1000-00"), the contact, and tax — richer than a raw Maybank line.
//
// Auth (per Bukku company, NOT per outlet — Shah Alam + Nilai share one
// company): Authorization: Bearer <token> + Company-Subdomain: <subdomain>.
//
// NOTE: the mappers here are pure and unit-tested against the documented
// example payloads. The networked sync (statement containers anchored on
// /accounts balances + idempotent upsert into BankStatement/Line) is built
// on top once we can verify shapes against a live token.
//
// Docs: https://developers.bukku.my  (spec: /specs/bukku-bank-api.yaml)

const BUKKU_BASE = process.env.BUKKU_API_BASE ?? "https://api.bukku.my";

export type BukkuCreds = {
  token: string;       // Access Token from Control Panel → Integrations
  subdomain: string;   // company subdomain (Company-Subdomain header)
};

// ── Wire shapes (subset of the documented fields we consume) ──────────────

export type BukkuMoneyTxn = {
  id: number;
  number: string;                 // e.g. OR-00001 / PV-00003
  date: string;                   // YYYY-MM-DD
  contact_name: string | null;
  amount: number;                 // always positive
  currency_code: string;
  status: string;                 // "ready" once recorded
  account_id: number;             // the BANK account the money hit
  account_name?: string | null;
  description: string | null;
};

export type BukkuTransferTxn = {
  id: number;
  number: string;                 // e.g. FT-00001
  date: string;
  amount: number;
  currency_code: string;
  status: string;
  account_id: number;             // FROM account
  account_name?: string | null;
  account2_id: number;            // TO account
  account2_name?: string | null;
  description: string | null;
};

export type BukkuAccount = {
  id: number;
  code?: string | null;           // COA code, e.g. "1000-00"
  name: string;
  balance: number | null;         // null for accounts that don't carry balances
};

type BukkuListResponse<T> = {
  transactions?: T[];
  accounts?: T[];
  paging?: { current_page: number; per_page: number; total: number };
};

// ── Neutral draft line — shaped to feed BankStatementLine ─────────────────
// Direction follows the bank account's perspective: CR = money in, DR = out.
// `bukkuAccountId` lets the sync route each line to the right bank account
// (and drop lines that hit non-bank COA accounts).

export type BukkuBankLineDraft = {
  bukkuId: number;        // source transaction id (idempotency key)
  bukkuAccountId: number; // which Bukku account this line debits/credits
  accountName: string | null;
  txnDate: string;        // YYYY-MM-DD
  description: string;
  reference: string;      // Bukku document number (OR-/PV-/FT-)
  amount: number;         // always positive
  direction: "CR" | "DR";
  isInterCo: boolean;     // transfers are internal movement by definition
};

// ── Mappers (pure) ────────────────────────────────────────────────────────

export function mapMoneyToLines(
  txns: BukkuMoneyTxn[],
  kind: "in" | "out",
): BukkuBankLineDraft[] {
  const direction = kind === "in" ? "CR" : "DR";
  return txns.map((t) => ({
    bukkuId: t.id,
    bukkuAccountId: t.account_id,
    accountName: t.account_name ?? null,
    txnDate: t.date,
    description: t.description ?? t.contact_name ?? t.number,
    reference: t.number,
    amount: t.amount,
    direction,
    isInterCo: false,
  }));
}

// A transfer is one record touching TWO accounts → two ledger lines:
// money leaves `account_id` (DR) and lands in `account2_id` (CR). The sync
// keeps whichever side hits a tracked bank account; both are flagged
// isInterCo so they don't distort cash-generation KPIs.
export function mapTransferToLines(txns: BukkuTransferTxn[]): BukkuBankLineDraft[] {
  const out: BukkuBankLineDraft[] = [];
  for (const t of txns) {
    const base = {
      bukkuId: t.id,
      txnDate: t.date,
      reference: t.number,
      amount: t.amount,
      isInterCo: true,
    };
    out.push({
      ...base,
      bukkuAccountId: t.account_id,
      accountName: t.account_name ?? null,
      description: t.description ?? `Transfer to ${t.account2_name ?? t.account2_id}`,
      direction: "DR",
    });
    out.push({
      ...base,
      bukkuAccountId: t.account2_id,
      accountName: t.account2_name ?? null,
      description: t.description ?? `Transfer from ${t.account_name ?? t.account_id}`,
      direction: "CR",
    });
  }
  return out;
}

// ── Raw bank feed ─────────────────────────────────────────────────────────
// The actual Maybank lines Bukku imports daily — independent of whether
// anyone reconciles in Bukku. This is the source that replaces PDF parsing.
//   GET /bank_feeds                                  → discover feed + linked account
//   GET /bank_feeds/{feedId}/accounts/{linkedId}/transactions  → raw lines
//   GET /banking/accounts                            → balance anchor
// The transactions endpoint is newest-first, paginated, and ignores
// date/sort params — so incremental sync pages until it hits a known id.

export type BukkuBankFeed = {
  id: number;
  bank: string;              // "MAYBANK"
  status: string;            // "CONNECTED"
  is_linked: boolean;
  accounts: Array<{
    id: number;
    ext_number: string;      // masked acct, e.g. ********2644
    ext_name: string | null;
    sync_starts_at: string | null;
    sync_ends_at: string | null;
    linked_account_id: number; // the COA bank account id the txns endpoint wants
  }>;
};

export type BukkuRawFeedLine = {
  id: number;                // stable, sequential → idempotency key
  date: string;              // "YYYY-MM-DD HH:mm:ss"
  description: string;
  debit_amount: string;      // "0.00" or value
  credit_amount: string;
};

export type BukkuBankAccount = {
  id: number;
  code: string | null;
  name: string;
  ext_number: string | null;
  balance: number | null;            // current book balance
  reconciled_balance: number | null; // verified balance...
  reconciled_date: string | null;    // ...as of this date
};

export async function listBankFeeds(creds: BukkuCreds): Promise<BukkuBankFeed[]> {
  const body = (await bukkuFetch<BukkuBankFeed>(creds, "/bank_feeds")) as { bank_feeds?: BukkuBankFeed[] };
  return body.bank_feeds ?? [];
}

export async function listBankAccounts(creds: BukkuCreds): Promise<BukkuBankAccount[]> {
  const body = (await bukkuFetch<BukkuBankAccount>(creds, "/banking/accounts")) as { accounts?: BukkuBankAccount[] };
  return body.accounts ?? [];
}

// Page the raw feed (newest-first) and stop early so a daily sync never
// pulls the whole history. Bounds:
//   - sinceId: stop once a line id <= this is reached (already stored).
//   - stopAtOrBeforeYmd: stop once a line dated on/before this is reached
//     (everything older is already covered by the PDF anchor).
// Leave both unset for a full backfill.
export async function fetchRawFeedLines(
  creds: BukkuCreds,
  feedId: number,
  linkedAccountId: number,
  opts: { sinceId?: number; stopAtOrBeforeYmd?: string } = {},
): Promise<BukkuRawFeedLine[]> {
  const { sinceId = 0, stopAtOrBeforeYmd } = opts;
  const path = `/bank_feeds/${feedId}/accounts/${linkedAccountId}/transactions`;
  const acc: BukkuRawFeedLine[] = [];
  let page = 1;
  for (let guard = 0; guard < 5000; guard++) {
    const body = (await bukkuFetch<BukkuRawFeedLine>(creds, path, { page, page_size: 100 })) as {
      transactions?: BukkuRawFeedLine[];
      paging?: { total: number };
    };
    const rows = body.transactions ?? [];
    if (rows.length === 0) break;
    let stop = false;
    for (const r of rows) {
      if (r.id <= sinceId) { stop = true; break; }
      if (stopAtOrBeforeYmd && r.date.slice(0, 10) <= stopAtOrBeforeYmd) { stop = true; break; }
      acc.push(r);
    }
    const total = body.paging?.total ?? acc.length;
    if (stop || acc.length >= total) break;
    page += 1;
  }
  return acc;
}

export function mapRawFeedToLines(lines: BukkuRawFeedLine[]): BukkuBankLineDraft[] {
  const out: BukkuBankLineDraft[] = [];
  for (const l of lines) {
    const credit = Number(l.credit_amount) || 0;
    const debit = Number(l.debit_amount) || 0;
    const amount = credit > 0 ? credit : debit;
    if (amount === 0) continue;  // skip zero-value feed rows
    out.push({
      bukkuId: l.id,
      bukkuAccountId: 0,                // raw feed is already per bank account
      accountName: null,
      txnDate: l.date.slice(0, 10),
      description: l.description.trim(),
      reference: String(l.id),
      amount,
      direction: credit > 0 ? "CR" : "DR",
      isInterCo: false,
    });
  }
  return out;
}

// ── Networked client ──────────────────────────────────────────────────────

async function bukkuFetch<T>(
  creds: BukkuCreds,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<BukkuListResponse<T>> {
  const url = new URL(path, BUKKU_BASE);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Company-Subdomain": creds.subdomain,
      Accept: "application/json",
    },
    // Always hit the network — this is a sync job, never cache.
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bukku ${path} → HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as BukkuListResponse<T>;
}

// Page through a list endpoint until we've collected `paging.total` rows.
async function listAll<T>(
  creds: BukkuCreds,
  path: string,
  key: "transactions" | "accounts",
  query: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const pageSize = 100;  // Bukku caps page_size at 100 (422 above that).
  const acc: T[] = [];
  let page = 1;
  // Hard cap pages so a bad `total` can't loop forever.
  for (let guard = 0; guard < 1000; guard++) {
    const body = await bukkuFetch<T>(creds, path, { ...query, page, page_size: pageSize });
    const rows = (body[key] as T[] | undefined) ?? [];
    acc.push(...rows);
    const total = body.paging?.total ?? acc.length;
    if (rows.length === 0 || acc.length >= total) break;
    page += 1;
  }
  return acc;
}

export function listIncomes(creds: BukkuCreds, dateFrom: string, dateTo: string) {
  return listAll<BukkuMoneyTxn>(creds, "/banking/incomes", "transactions", { date_from: dateFrom, date_to: dateTo });
}
export function listExpenses(creds: BukkuCreds, dateFrom: string, dateTo: string) {
  return listAll<BukkuMoneyTxn>(creds, "/banking/expenses", "transactions", { date_from: dateFrom, date_to: dateTo });
}
export function listTransfers(creds: BukkuCreds, dateFrom: string, dateTo: string) {
  return listAll<BukkuTransferTxn>(creds, "/banking/transfers", "transactions", { date_from: dateFrom, date_to: dateTo });
}
export function listAccounts(creds: BukkuCreds) {
  return listAll<BukkuAccount>(creds, "/accounts", "accounts");
}

// Pull a full window of bank lines for one company in one call. The sync
// layer maps these onto BankStatement/BankStatementLine, routing by
// bukkuAccountId → our tracked bank accounts.
export async function fetchBankLines(
  creds: BukkuCreds,
  dateFrom: string,
  dateTo: string,
): Promise<BukkuBankLineDraft[]> {
  const [incomes, expenses, transfers] = await Promise.all([
    listIncomes(creds, dateFrom, dateTo),
    listExpenses(creds, dateFrom, dateTo),
    listTransfers(creds, dateFrom, dateTo),
  ]);
  return [
    ...mapMoneyToLines(incomes, "in"),
    ...mapMoneyToLines(expenses, "out"),
    ...mapTransferToLines(transfers),
  ];
}
