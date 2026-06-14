// Bank-feed ingest (IO shell) — lands normalized bank lines into
// fin_bank_transactions, idempotently. The Matcher then consumes the
// `unmatched` rows this writes.
//
// Idempotent on two levels: intra-batch dupes are dropped in-memory, and
// cross-import dupes are absorbed by ON CONFLICT DO NOTHING against the table's
// composite unique constraint. Re-running the same feed window is a no-op.
//
// This is the source-agnostic half. The Bukku adapter (pending the API sample)
// maps Bukku's bank-transaction response to BankLineInput[] and calls this.

import { getFinanceClient, setActor } from "../supabase";
import { buildBankTxnRow, dedupeRows, type BankLineInput, type BankTxnRow } from "./bank-feed-build";

export const BANK_FEED_VERSION = "bank-feed-v1";

export type BankIngestResult = {
  received: number;
  valid: number;
  inserted: number;
  duplicates: number;
  invalid: { index: number; error: string }[];
};

export async function ingestBankLines(inputs: BankLineInput[]): Promise<BankIngestResult> {
  const client = getFinanceClient();
  await setActor(client, BANK_FEED_VERSION);

  const rows: BankTxnRow[] = [];
  const invalid: { index: number; error: string }[] = [];
  inputs.forEach((inp, i) => {
    const built = buildBankTxnRow(inp);
    if (built.ok) rows.push(built.row);
    else invalid.push({ index: i, error: built.error });
  });

  const deduped = dedupeRows(rows);

  let inserted = 0;
  if (deduped.length > 0) {
    const { data, error } = await client
      .from("fin_bank_transactions")
      .upsert(deduped, {
        onConflict: "bank_account_code,txn_date,amount,description,reference",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw error;
    inserted = data?.length ?? 0;
  }

  return {
    received: inputs.length,
    valid: rows.length,
    inserted,
    duplicates: rows.length - inserted, // valid rows that didn't produce a new insert
    invalid,
  };
}
