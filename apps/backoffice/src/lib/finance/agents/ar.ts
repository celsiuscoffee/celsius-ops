// AR Agent — Auto-posts daily revenue journals from a per-outlet EOD summary.
//
// Confidence model:
//  - Cash/QR/Card/Voucher/Grabfood splits with known tender types: 0.95
//  - Falls back to "other" bucket → exception (humans pick the right channel)
//
// Pure function: takes a structured summary, posts one journal per outlet/day,
// returns transaction id. Does not fetch from StoreHub directly — that's the
// ingestor's job.

import { postJournal } from "../ledger";
import type { JournalLineInput, PostJournalResult } from "../types";

export const AR_AGENT_VERSION = "ar-v1";

// Tender → revenue/debtor account mapping. Keep this aligned with the COA seed.
//
// cash_qr  → 5000-01 Cash and QR sales      / 1000-02 Cash on Hand
// card     → 5000-02 Card                   / 1006   Debit/credit card debtors
// voucher  → 5000-03 Voucher/redeem/mulah   / 1007   Voucher debtor
// grabfood → 5000-04 Grabfood               / 1005   Grabfood debtors
// gastrohub→ 5000-09 GastroHub              / 1001-00 AR
//
// Amounts are NET of discounts and EXCLUDE SST. SST is broken out separately.

export type EodChannelSplit = {
  cashQr: number;
  card: number;
  voucher: number;
  grabfood: number;
  gastrohub: number;
  other: number;
};

export type EodSummary = {
  companyId: string;        // legal entity owning the outlet
  outletId: string;
  outletName: string;
  date: string;             // YYYY-MM-DD (MYT)
  transactions: number;     // count of POS transactions
  netSales: number;         // sum of all channel splits (excl SST)
  sst: number;              // SST output collected
  discounts: number;        // total discount given (gross to net)
  channels: EodChannelSplit;
  sourceDocId: string | null;  // fin_documents.id pointing to the StoreHub EOD blob
  storehubRefIds: string[]; // for traceability
};

const REVENUE: Record<keyof EodChannelSplit, string> = {
  cashQr: "5000-01",
  card: "5000-02",
  voucher: "5000-03",
  grabfood: "5000-04",
  gastrohub: "5000-09",
  other: "5000-01",  // fallback; ideally exception path catches these
};

const DEBTOR: Record<keyof EodChannelSplit, string> = {
  cashQr: "1000-02",
  card: "1006",
  voucher: "1007",
  grabfood: "1005",
  gastrohub: "1001-00",
  other: "1000-02",
};

export type ArAgentResult = {
  transactionId: string;
  amount: number;
  outletId: string;
  date: string;
};

export async function postDailyAr(summary: EodSummary): Promise<ArAgentResult> {
  const channels = summary.channels;
  const lines: JournalLineInput[] = [];

  // Debits — one per tender bucket that's non-zero
  for (const key of Object.keys(channels) as (keyof EodChannelSplit)[]) {
    const amount = round2(channels[key]);
    if (amount === 0) continue;
    lines.push({
      accountCode: DEBTOR[key],
      outletId: summary.outletId,
      debit: amount,
      memo: `${labelFor(key)} sales — ${summary.outletName} ${summary.date}`,
    });
  }

  // Credits — one per revenue channel
  for (const key of Object.keys(channels) as (keyof EodChannelSplit)[]) {
    const amount = round2(channels[key]);
    if (amount === 0) continue;
    lines.push({
      accountCode: REVENUE[key],
      outletId: summary.outletId,
      credit: amount,
      memo: `${labelFor(key)} revenue — ${summary.outletName} ${summary.date}`,
    });
  }

  // SST output — net of CR debtor adjustment
  // When SST is collected, gross paid by customer = netSales + sst.
  // The debtor lines above use netSales-equivalent splits, so we book SST
  // separately: increase a tender debtor by sst (assume cash_qr default
  // for v1 — auditor can adjust via reclass), credit 3002.
  if (summary.sst > 0) {
    lines.push({
      accountCode: "1000-02",
      outletId: summary.outletId,
      debit: round2(summary.sst),
      memo: `SST collected — ${summary.outletName} ${summary.date}`,
    });
    lines.push({
      accountCode: "3002",
      outletId: summary.outletId,
      credit: round2(summary.sst),
      memo: `SST output — ${summary.outletName} ${summary.date}`,
    });
  }

  // Discounts given — booked separately so audit trail shows gross→net.
  // Only post if we want to track discount as a contra-revenue. For v1 we
  // assume netSales already excludes discounts (so this is informational only).
  // Skip the journal entry; record it in the description.
  const description =
    `EOD Sales — ${summary.outletName} ${summary.date} ` +
    `(${summary.transactions} txns, RM${summary.netSales.toFixed(2)} net` +
    (summary.discounts > 0 ? `, RM${summary.discounts.toFixed(2)} disc` : "") +
    `)`;

  // Confidence: drop if any "other" bucket has material amount.
  const otherShare = channels.other / Math.max(summary.netSales, 1);
  const confidence = otherShare > 0.05 ? 0.6 : 0.95;

  const result: PostJournalResult = await postJournal({
    companyId: summary.companyId,
    txnDate: summary.date,
    description,
    txnType: "ar_invoice",
    outletId: summary.outletId,
    sourceDocId: summary.sourceDocId,
    agent: "ar",
    agentVersion: AR_AGENT_VERSION,
    confidence,
    lines,
    draft: confidence < 0.85,  // low-confidence days held for human review
  });

  return {
    transactionId: result.transactionId,
    amount: result.amount,
    outletId: summary.outletId,
    date: summary.date,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function labelFor(key: keyof EodChannelSplit): string {
  return {
    cashQr: "Cash/QR",
    card: "Card",
    voucher: "Voucher",
    grabfood: "Grabfood",
    gastrohub: "GastroHub",
    other: "Other",
  }[key];
}
