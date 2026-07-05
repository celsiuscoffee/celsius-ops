// Paged ledger reads. Supabase caps unpaged selects at 1000 rows, which
// silently truncated whole-ledger walks once the journal count grew past
// that: the Balance Sheet and Cash Flow disagreed with the Trial Balance
// and General Ledger (which already page) on high-volume accounts.
import { getFinanceClient } from "../supabase";

const PAGE = 1000;

// Every posted transaction id (with its date) for the companies through `to`.
export async function pagedPostedTxns(
  companyIds: string[],
  to: string
): Promise<{ txnIds: string[]; txnDate: Map<string, string> }> {
  const client = getFinanceClient();
  const txnIds: string[] = [];
  const txnDate = new Map<string, string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await client
      .from("fin_transactions")
      .select("id, txn_date")
      .eq("status", "posted")
      .lte("txn_date", to)
      .in("company_id", companyIds)
      .order("txn_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    for (const t of data ?? []) {
      txnIds.push(t.id as string);
      txnDate.set(t.id as string, t.txn_date as string);
    }
    if (!data || data.length < PAGE) break;
  }
  return { txnIds, txnDate };
}

export type PagedJournalLine = {
  transaction_id: string;
  account_code: string;
  debit: number;
  credit: number;
};

// Journal lines for the given transactions, chunked and paged within each
// chunk: 200 txns can carry more than 1000 lines (EOD sales journals post
// many legs), so the chunk read pages too.
export async function* pagedJournalLines(
  txnIds: string[]
): AsyncGenerator<PagedJournalLine[]> {
  const client = getFinanceClient();
  for (let i = 0; i < txnIds.length; i += 200) {
    const chunk = txnIds.slice(i, i + 200);
    for (let offset = 0; ; offset += PAGE) {
      const { data } = await client
        .from("fin_journal_lines")
        .select("transaction_id, account_code, debit, credit")
        .in("transaction_id", chunk)
        .order("transaction_id", { ascending: true })
        .order("line_order", { ascending: true })
        .range(offset, offset + PAGE - 1);
      yield (data ?? []) as PagedJournalLine[];
      if (!data || data.length < PAGE) break;
    }
  }
}
