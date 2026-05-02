// StoreHub EOD ingestor — pulls one day of transactions per outlet, classifies
// payment types into our channel buckets, persists the raw blob to fin_documents,
// then hands a structured EodSummary to the AR agent.
//
// Tender classification (StoreHub `payments[].type` → our channel):
//
//  Cash, QR, TouchnGo, GrabPay, Boost, Maybank QR        → cashQr
//  Card, Visa, Mastercard, Debit, AMEX                    → card
//  Voucher, Mulah, Member, Freeflow, Redeem               → voucher
//  GrabFood, FoodPanda, ShopeeFood                        → grabfood
//  GastroHub, Vendor                                      → gastrohub
//  Anything else                                          → other  (drops AR confidence)
//
// `channel` field on the StoreHub transaction wins over tender mapping when
// it indicates a delivery aggregator — e.g. a card-paid Grab order should
// land in grabfood, not card.

import { randomUUID } from "crypto";
import { getTransactions } from "@/lib/storehub";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "../supabase";
import { postDailyAr, type EodSummary, type EodChannelSplit } from "../agents/ar";
import { resolveCompanyFromOutlet, getDefaultCompanyId } from "../companies";
import type { StoreHubTransaction } from "@/lib/storehub";

type ChannelKey = keyof EodChannelSplit;

const CASH_QR_TYPES = new Set(["CASH", "QR", "TOUCHNGO", "TNG", "GRABPAY", "BOOST", "MAYBANK QR", "MAE", "DUITNOW"]);
const CARD_TYPES = new Set(["CARD", "VISA", "MASTERCARD", "MASTER", "DEBIT", "DEBIT CARD", "CREDIT CARD", "AMEX"]);
const VOUCHER_TYPES = new Set(["VOUCHER", "MULAH", "MEMBER", "FREEFLOW", "REDEEM", "GIFT CARD"]);
const GRAB_TYPES = new Set(["GRABFOOD", "GRAB", "GRAB FOOD"]);
const PANDA_TYPES = new Set(["FOODPANDA", "FOOD PANDA"]);
const SHOPEE_TYPES = new Set(["SHOPEEFOOD", "SHOPEE FOOD"]);

function classifyTender(type: string): ChannelKey {
  const t = type.trim().toUpperCase();
  if (CASH_QR_TYPES.has(t)) return "cashQr";
  if (CARD_TYPES.has(t)) return "card";
  if (VOUCHER_TYPES.has(t)) return "voucher";
  if (GRAB_TYPES.has(t) || PANDA_TYPES.has(t) || SHOPEE_TYPES.has(t)) return "grabfood";
  if (t.includes("GASTRO") || t.includes("VENDOR")) return "gastrohub";
  return "other";
}

function classifyChannel(channel: string | undefined): ChannelKey | null {
  if (!channel) return null;
  const c = channel.trim().toUpperCase();
  if (c.includes("GRAB") || c.includes("PANDA") || c.includes("SHOPEE")) return "grabfood";
  if (c.includes("GASTRO")) return "gastrohub";
  return null;
}

function emptySplit(): EodChannelSplit {
  return { cashQr: 0, card: 0, voucher: 0, grabfood: 0, gastrohub: 0, other: 0 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Aggregates transactions for ONE outlet on ONE day into an EodSummary.
// Splits by tender unless the txn's channel field indicates a delivery
// aggregator, in which case the whole transaction is bucketed to that channel.
export function aggregateEod(
  companyId: string,
  outletId: string,
  outletName: string,
  date: string,
  transactions: StoreHubTransaction[],
  sourceDocId: string | null
): EodSummary {
  const channels = emptySplit();
  let netSales = 0;
  let sst = 0;
  let discounts = 0;
  let txnCount = 0;
  const refIds: string[] = [];

  for (const txn of transactions) {
    if (txn.isCancelled) continue;
    if (txn.transactionType && txn.transactionType.toLowerCase().includes("refund")) continue;

    txnCount += 1;
    refIds.push(txn.refId);

    const total = Number(txn.total ?? 0);
    const subTotal = Number(txn.subTotal ?? total);
    // SST = total - subTotal when SST is on; assumes 6% Malaysian SST.
    const txnSst = round2(Math.max(total - subTotal, 0));
    sst += txnSst;

    // Discounts — StoreHub typically reports them on items but rolls up via
    // (gross items - subTotal). We approximate: any "discount" tag/remark or
    // discount line not modelled in StoreHubTransactionItem here. Track 0
    // for v1; the close agent can run a reclass if material.
    discounts += 0;

    // Channel-level override
    const txnAggregator = classifyChannel((txn.channel as string | undefined) ?? undefined);

    const rawPayments = (txn as unknown as { payments?: unknown }).payments;
    const payments: Array<{ type: string; amount: number }> = Array.isArray(rawPayments)
      ? (rawPayments as Array<{ type: string; amount: number }>)
      : [];

    if (payments.length === 0) {
      // Fallback: assume cash/QR
      const bucket: ChannelKey = txnAggregator ?? "cashQr";
      channels[bucket] += subTotal;
      netSales += subTotal;
      continue;
    }

    // Distribute each payment line across channels. SST-portion of each
    // payment is netted out below (we already added total SST once).
    const paymentSum = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const sstPortion = paymentSum > 0 ? txnSst / paymentSum : 0;

    for (const p of payments) {
      const amount = Number(p.amount ?? 0);
      if (amount === 0) continue;
      const netAmount = round2(amount * (1 - sstPortion));
      const bucket: ChannelKey = txnAggregator ?? classifyTender(p.type ?? "");
      channels[bucket] += netAmount;
      netSales += netAmount;
    }
  }

  // Round all bucket totals
  for (const k of Object.keys(channels) as ChannelKey[]) {
    channels[k] = round2(channels[k]);
  }

  return {
    companyId,
    outletId,
    outletName,
    date,
    transactions: txnCount,
    netSales: round2(netSales),
    sst: round2(sst),
    discounts: round2(discounts),
    channels,
    sourceDocId,
    storehubRefIds: refIds,
  };
}

// Persists the raw StoreHub blob as a fin_documents row so the AR agent's
// posted journal has provenance. Idempotent on (source, source_ref).
async function persistDoc(
  companyId: string,
  outletId: string,
  date: string,
  transactions: StoreHubTransaction[]
): Promise<string> {
  const client = getFinanceClient();
  const sourceRef = `storehub-eod-${outletId}-${date}`;

  const { data: existing } = await client
    .from("fin_documents")
    .select("id")
    .eq("source", "storehub")
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const id = randomUUID();
  const { error } = await client.from("fin_documents").insert({
    id,
    company_id: companyId,
    source: "storehub",
    source_ref: sourceRef,
    doc_type: "pos_eod",
    outlet_id: outletId,
    raw_text: null,
    metadata: {
      date,
      transactionCount: transactions.length,
      transactions,  // full payload for replay
    },
    received_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    status: "processed",
  });
  if (error) throw error;
  return id;
}

export type IngestEodResult = {
  outletId: string;
  outletName: string;
  date: string;
  transactionsFetched: number;
  posted?: { transactionId: string; amount: number };
  skipped?: string;
  error?: string;
};

// Ingests one outlet for one date. Idempotent — re-running the same outlet+date
// returns the existing journal id without double-posting.
export async function ingestOutletEod(
  outletId: string,
  date: string                     // YYYY-MM-DD (MYT)
): Promise<IngestEodResult> {
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true, storehubId: true },
  });
  if (!outlet) {
    return { outletId, outletName: "?", date, transactionsFetched: 0, error: "outlet not found" };
  }
  if (!outlet.storehubId) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: 0,
      skipped: "outlet has no storehubId",
    };
  }

  // Already posted? (idempotency check across both AR draft + posted.)
  const client = getFinanceClient();
  const { data: existingTxn } = await client
    .from("fin_transactions")
    .select("id, amount")
    .eq("outlet_id", outletId)
    .eq("txn_date", date)
    .eq("txn_type", "ar_invoice")
    .eq("posted_by_agent", "ar")
    .maybeSingle();
  if (existingTxn?.id) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: 0,
      posted: { transactionId: existingTxn.id as string, amount: Number(existingTxn.amount) },
      skipped: "already posted",
    };
  }

  // MYT day boundaries: 00:00 to 24:00 in Asia/Kuala_Lumpur (UTC+8).
  const from = new Date(`${date}T00:00:00+08:00`);
  const to = new Date(`${date}T23:59:59.999+08:00`);

  let transactions: StoreHubTransaction[] = [];
  try {
    transactions = await getTransactions(outlet.storehubId, from, to);
  } catch (err) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (transactions.length === 0) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: 0,
      skipped: "no transactions",
    };
  }

  const companyId =
    (await resolveCompanyFromOutlet(outletId)) ?? (await getDefaultCompanyId());

  const docId = await persistDoc(companyId, outletId, date, transactions);
  const summary = aggregateEod(companyId, outletId, outlet.name, date, transactions, docId);

  if (summary.netSales <= 0) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: transactions.length,
      skipped: "zero net sales after refunds",
    };
  }

  try {
    const result = await postDailyAr(summary);
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: transactions.length,
      posted: { transactionId: result.transactionId, amount: result.amount },
    };
  } catch (err) {
    return {
      outletId,
      outletName: outlet.name,
      date,
      transactionsFetched: transactions.length,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Ingests all active outlets for a given date. Used by the daily cron.
export async function ingestAllOutletsEod(date: string): Promise<IngestEodResult[]> {
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", storehubId: { not: null } },
    select: { id: true },
  });
  const results: IngestEodResult[] = [];
  for (const o of outlets) {
    results.push(await ingestOutletEod(o.id, date));
  }
  return results;
}
