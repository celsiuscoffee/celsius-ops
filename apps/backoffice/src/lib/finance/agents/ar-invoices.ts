// Channel-tagged AR invoice builder (pure).
//
// The AR agent posts ONE daily journal per outlet, but reconciliation needs
// per-channel receivables: a card settlement lands in the bank as the card
// total, a QR settlement as the QR total, etc. Without a per-channel invoice
// the Matcher has nothing of the right grain to match a settlement against.
//
// So for each non-zero channel we emit a fin_invoices row whose `total` is what
// the bank will receive for that channel (channel net + its share of SST).
// SST is allocated proportionally to each channel's net — exact when the SST
// rate is uniform across sales, which it is.
//
// invoice_number is deterministic (AR-<outlet>-<date>-<channel>) so re-running
// the day is idempotent via the unique constraint. Type-only import of the AR
// shapes is erased at build, so this module pulls in no IO.

import { randomUUID } from "crypto";
import type { EodSummary, EodChannelSplit } from "./ar";

// EodChannelSplit key -> fin_invoices.channel enum value.
const CHANNEL_CODE: Record<keyof EodChannelSplit, string> = {
  cashQr: "cash_qr",
  card: "card",
  voucher: "voucher",
  grabfood: "grabfood",
  gastrohub: "gastrohub",
  other: "other",
};

export type ChannelInvoiceRow = {
  id: string;
  company_id: string;
  invoice_number: string;
  customer_id: null;
  outlet_id: string;
  channel: string;
  invoice_date: string;
  due_date: null;
  subtotal: number;
  sst_amount: number;
  total: number;
  payment_status: "unpaid";
  paid_amount: number;
  transaction_id: string;
  source_doc_id: string | null;
  notes: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildChannelInvoices(summary: EodSummary, transactionId: string): ChannelInvoiceRow[] {
  const net = summary.netSales;
  const rows: ChannelInvoiceRow[] = [];

  for (const key of Object.keys(summary.channels) as (keyof EodChannelSplit)[]) {
    const channelNet = round2(summary.channels[key]);
    if (channelNet <= 0) continue;

    const sstShare = net > 0 ? round2((summary.sst * channelNet) / net) : 0;
    const total = round2(channelNet + sstShare);
    const channel = CHANNEL_CODE[key];

    rows.push({
      id: randomUUID(),
      company_id: summary.companyId,
      invoice_number: `AR-${summary.outletId}-${summary.date}-${channel}`,
      customer_id: null,
      outlet_id: summary.outletId,
      channel,
      invoice_date: summary.date,
      due_date: null,
      subtotal: channelNet,
      sst_amount: sstShare,
      total,
      payment_status: "unpaid",
      paid_amount: 0,
      transaction_id: transactionId,
      source_doc_id: summary.sourceDocId,
      notes: `${channel} sales — ${summary.outletName} ${summary.date}`,
    });
  }

  return rows;
}
