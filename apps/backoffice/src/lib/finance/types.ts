// Types mirroring the fin_* Postgres tables. Kept hand-written rather than
// generated from Supabase to make the contract explicit at agent boundaries.

export type AccountType = "asset" | "liability" | "equity" | "income" | "cogs" | "expense";

export type TxnType =
  | "ar_invoice"
  | "ap_bill"
  | "payment"
  | "journal"
  | "depreciation"
  | "fx_adj"
  | "reversal";

export type TxnStatus = "draft" | "posted" | "exception" | "reversed";

export type AgentName =
  | "ingestor"
  | "categorizer"
  | "matcher"
  | "ap"
  | "ar"
  | "close"
  | "compliance"
  | "anomaly"
  | "manual";

export type ExceptionType =
  | "categorization"
  | "match"
  | "missing_doc"
  | "anomaly"
  | "duplicate"
  | "out_of_balance";

export type Channel =
  | "cash_qr"
  | "card"
  | "grabfood"
  | "voucher"
  | "gastrohub"
  | "meetings"
  | "other";

// One side of a double-entry. Exactly one of debit/credit is non-zero.
export type JournalLineInput = {
  accountCode: string;
  outletId?: string | null;
  debit?: number;
  credit?: number;
  memo?: string;
};

export type PostJournalInput = {
  companyId: string;      // legal entity owning the journal — every line rolls up here
  txnDate: string;        // YYYY-MM-DD
  description: string;
  txnType: TxnType;
  outletId?: string | null;
  sourceDocId?: string | null;
  agent: AgentName;
  agentVersion: string;
  confidence: number;     // 0-1; agents below their threshold should NOT call this — they should write fin_exceptions instead
  lines: JournalLineInput[];
  // Optional: leave as draft instead of auto-posting. Used during dual-run or backfill.
  draft?: boolean;
};

export type PostJournalResult = {
  transactionId: string;
  journalLineIds: string[];
  amount: number;         // absolute total (sum of debits)
  status: TxnStatus;
};
