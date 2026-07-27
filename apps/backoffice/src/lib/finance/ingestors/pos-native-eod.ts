// POS-native EOD ingestor — the StoreHub-free replacement for storehub-eod.ts.
//
// Builds the same EodSummary the AR agent consumes, but sourced from our own
// system instead of the StoreHub API:
//   • pos_orders (+ pos_order_payments) — the till / register, and native
//     GrabFood orders (source='grabfood', no payment rows → bucketed by source).
//   • orders — the Celsius pickup/ordering app. This is where the former
//     StoreHub "Beep" online channel now lands, so it MUST be included or the
//     online revenue StoreHub-EOD used to post would silently vanish from AR.
//
// An outlet's day is sourced from whichever POS owned it that day: the cron
// router (ingestEodForDate) sends pre-cutover dates to the StoreHub ingestor and
// on/after-cutover dates here. posNativeCutoverAt is always set to midnight MYT,
// so a day is never split across both POSs — no double-count risk.
//
// Idempotent: re-running the same outlet+date returns the existing AR journal
// without re-posting (shares storehub-eod's per-day guard, keyed only on
// outlet+date+ar_invoice, so a day can be posted by at most one source).
//
// Amounts: pos_orders/orders store sen. netSales is RM, NET of SST
// (total − sst_amount); the AR agent books SST separately. Tender → channel
// mapping mirrors storehub-eod's classifier. Two policy calls worth a finance
// review: the Celsius-app "wallet" tender is treated as cash-equivalent
// (cashQr), since the cash was collected at top-up; partial refunds recorded on
// a payment row (refund_amount) are not netted in v1 (full refunds are separate
// reversal orders, excluded via refund_of_order_id).

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getFinanceClient } from "../supabase";
import { postDailyAr, type EodSummary, type EodChannelSplit } from "../agents/ar";
import { resolveCompanyFromOutlet, getDefaultCompanyId } from "../companies";
import { GL_POSTING_CUTOVER } from "../gl-posting-map";
import type { IngestEodResult } from "./storehub-eod";
import { ingestOutletEod } from "./storehub-eod";

type ChannelKey = keyof EodChannelSplit;

// Normalize a tender label for robust matching: uppercase, strip non-alphanumerics.
function normTender(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const CASH_QR_TENDERS = new Set([
  "CASH",
  "QR", "QRCODE", "DUITNOW", "DUITNOWQR", "MAYBANKQR", "MAE",
  "ONLINEBANKING", "FPX",
  "TOUCHNGOEWALLET", "TNG", "TNGEWALLET",
  "GRABPAY", "BOOST", "SHOPEEPAY",
  "WALLET", // Celsius-app stored value — settled as cash at top-up (see header).
]);
const CARD_TENDERS = new Set([
  "CARD", "DEBITCARD", "CREDITCARD", "VISA", "MASTERCARD", "MASTER", "AMEX",
  "APPLEPAY", "GOOGLEPAY", "SAMSUNGPAY",
]);
const VOUCHER_TENDERS = new Set([
  "VOUCHER", "REDEEM", "REWARD", "MEMBER", "FREEFLOW", "MULAH", "GIFTCARD", "STORECREDIT",
]);

function classifyTender(method: string | null | undefined): ChannelKey {
  const t = normTender(method ?? "");
  if (!t) return "cashQr"; // unknown/blank tender on a real sale → assume cash/QR
  if (CASH_QR_TENDERS.has(t)) return "cashQr";
  if (CARD_TENDERS.has(t)) return "card";
  if (VOUCHER_TENDERS.has(t)) return "voucher";
  return "other"; // genuinely unrecognized → drops AR confidence → exception
}

// Whole-order channel override when the order came from a delivery aggregator
// (native Grab, etc.). These settle net of commission via a debtor, like the
// StoreHub-side `channel` override.
function classifySourceOverride(source: string | null | undefined): ChannelKey | null {
  const s = (source ?? "").toLowerCase();
  if (/grab|foodpanda|shopee|deliveroo|panda/.test(s)) return "grabfood";
  return null;
}

function emptySplit(): EodChannelSplit {
  return { cashQr: 0, card: 0, voucher: 0, grabfood: 0, gastrohub: 0, other: 0 };
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type OrderRow = {
  id: string;
  source: string | null;
  subtotal: number | null;
  sst_amount: number | null;
  total: number | null;
  discount_amount: number | null;
};
type PaymentRow = { order_id: string; payment_method: string | null; amount: number | null };

// Aggregates one outlet's orders for one day into an EodSummary.
// `posPayments` maps pos_orders.id → its payment lines; pickup `orders` carry
// their single tender inline (order.payment_method, handled via a synthetic line).
export function aggregateNativeEod(
  companyId: string,
  outletId: string,
  outletName: string,
  date: string,
  orders: OrderRow[],
  paymentsByOrder: Map<string, PaymentRow[]>,
  sourceDocId: string | null,
): EodSummary {
  const channels = emptySplit();
  let netSales = 0;
  let sst = 0;
  let discounts = 0;
  let txnCount = 0;
  const refIds: string[] = [];

  for (const o of orders) {
    const total = Number(o.total ?? 0) / 100;
    const sstRm = Number(o.sst_amount ?? 0) / 100;
    const net = round2(Math.max(total - sstRm, 0)); // revenue ex-SST
    if (net <= 0) continue;

    txnCount += 1;
    refIds.push(o.id);
    sst += sstRm;
    // pos_orders.discount_amount is the TOTAL discount on the order; the
    // promo_discount / reward_discount_amount columns are its reason
    // breakdown, not additional amounts. The pickup query above aliases its
    // own components into the same field.
    discounts += Number(o.discount_amount ?? 0) / 100;

    // Delivery aggregator → whole order to that channel, ignore tender.
    const override = classifySourceOverride(o.source);
    if (override) {
      channels[override] += net;
      netSales += net;
      continue;
    }

    const lines = paymentsByOrder.get(o.id) ?? [];
    const paySum = lines.reduce((s, p) => s + Number(p.amount ?? 0), 0);
    if (lines.length === 0 || paySum <= 0) {
      // No tender detail (offline sync gap, comp, etc.) → assume cash/QR.
      channels.cashQr += net;
      netSales += net;
      continue;
    }
    // Split the SST-excluded net across tenders by their paid proportion.
    for (const p of lines) {
      const amt = Number(p.amount ?? 0);
      if (amt === 0) continue;
      const share = round2(net * (amt / paySum));
      channels[classifyTender(p.payment_method)] += share;
      netSales += share;
    }
  }

  for (const k of Object.keys(channels) as ChannelKey[]) channels[k] = round2(channels[k]);

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
    storehubRefIds: refIds, // native order ids — same provenance slot
  };
}

// Persists the native EOD as a fin_documents row (source='pos_native') for
// journal provenance. Idempotent on (source, source_ref).
async function persistDoc(
  companyId: string,
  outletId: string,
  date: string,
  orders: OrderRow[],
): Promise<string> {
  const client = getFinanceClient();
  const sourceRef = `pos-native-eod-${outletId}-${date}`;

  const { data: existing } = await client
    .from("fin_documents")
    .select("id")
    .eq("source", "pos_native")
    .eq("source_ref", sourceRef)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const id = randomUUID();
  const { error } = await client.from("fin_documents").insert({
    id,
    company_id: companyId,
    source: "pos_native",
    source_ref: sourceRef,
    doc_type: "pos_eod",
    outlet_id: outletId,
    raw_text: null,
    metadata: { date, orderCount: orders.length, orderIds: orders.map((o) => o.id) },
    received_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    status: "processed",
  });
  if (error) throw error;
  return id;
}

// Ingests one outlet for one MYT date from native sources. Idempotent — reuses
// the same outlet+date guard as the StoreHub ingestor, so a day already posted
// (by either source) is never double-posted.
export async function ingestOutletNativeEod(
  outlet: { id: string; name: string; loyaltyOutletId: string | null; pickupStoreId: string | null },
  date: string,
  opts: { includeStorehubDelivery?: boolean } = {},
): Promise<IngestEodResult> {
  const { id: outletId, name: outletName } = outlet;

  // GL posting cutover: 2025 books live in Bukku. Refusing pre-cutover dates
  // here (not just in the cron router) keeps backfills and manual replays from
  // recreating 2025 AR journals after the balance sheet surgery deletes them.
  if (date < GL_POSTING_CUTOVER) {
    return { outletId, outletName, date, transactionsFetched: 0, skipped: `pre-cutover date (GL starts ${GL_POSTING_CUTOVER})` };
  }

  // Already posted for this outlet/day? (matches storehub-eod's guard.) A
  // REVERSED journal doesn't count — that's how the cutover backfill re-posts a
  // day after reversing its stale StoreHub partial.
  const client = getFinanceClient();
  const { data: existingTxn } = await client
    .from("fin_transactions")
    .select("id, amount")
    .eq("outlet_id", outletId)
    .eq("txn_date", date)
    .eq("txn_type", "ar_invoice")
    .eq("posted_by_agent", "ar")
    .neq("status", "reversed")
    .maybeSingle();
  if (existingTxn?.id) {
    return {
      outletId, outletName, date, transactionsFetched: 0,
      posted: { transactionId: existingTxn.id as string, amount: Number(existingTxn.amount) },
      skipped: "already posted",
    };
  }

  // MYT day boundaries (UTC+8).
  const from = new Date(`${date}T00:00:00+08:00`);
  const to = new Date(`${date}T23:59:59.999+08:00`);

  const orders: OrderRow[] = [];
  const paymentsByOrder = new Map<string, PaymentRow[]>();

  // ── Till + native delivery (pos_orders) ──
  if (outlet.loyaltyOutletId) {
    const posRows = await prisma.$queryRaw<OrderRow[]>`
      SELECT id, source, subtotal, sst_amount, total, discount_amount
      FROM pos_orders
      WHERE outlet_id = ${outlet.loyaltyOutletId}
        AND status = 'completed'
        AND refund_of_order_id IS NULL
        AND created_at >= ${from} AND created_at <= ${to}
    `;
    orders.push(...posRows);
    if (posRows.length > 0) {
      const ids = posRows.map((r) => r.id);
      const pays = await prisma.$queryRaw<PaymentRow[]>`
        SELECT order_id, payment_method, amount
        FROM pos_order_payments
        WHERE order_id IN (${Prisma.join(ids)})
          AND COALESCE(status, 'completed') NOT IN ('failed', 'voided', 'cancelled')
      `;
      for (const p of pays) {
        const arr = paymentsByOrder.get(p.order_id) ?? [];
        arr.push(p);
        paymentsByOrder.set(p.order_id, arr);
      }
    }
  }

  // ── Celsius pickup/ordering app (orders) — the former Beep online channel.
  // Single inline tender per order → synthesize a payment line for `total`. ──
  if (outlet.pickupStoreId) {
    const pickupRows = await prisma.$queryRaw<Array<OrderRow & { payment_method: string | null }>>`
      SELECT id, source, subtotal, sst_amount, total, payment_method,
             -- The pickup app uses the OPPOSITE discount convention to the
             -- till: orders.discount_amount is unused (0 on every paid 2026
             -- order) and the three components below ARE the discount. Reading
             -- discount_amount here reported every pickup discount as zero.
             COALESCE(promo_discount, 0) + COALESCE(reward_discount_amount, 0)
               + COALESCE(first_order_discount_amount, 0) AS discount_amount
      FROM orders
      WHERE store_id = ${outlet.pickupStoreId}
        AND status = 'completed'
        AND created_at >= ${from} AND created_at <= ${to}
    `;
    for (const r of pickupRows) {
      orders.push(r);
      paymentsByOrder.set(r.id, [
        { order_id: r.id, payment_method: r.payment_method, amount: Number(r.total ?? 0) },
      ]);
    }
  }

  if (orders.length === 0) {
    return { outletId, outletName, date, transactionsFetched: 0, skipped: "no native orders" };
  }

  const companyId = (await resolveCompanyFromOutlet(outletId)) ?? (await getDefaultCompanyId());
  const docId = await persistDoc(companyId, outletId, date, orders);
  const summary = aggregateNativeEod(companyId, outletId, outletName, date, orders, paymentsByOrder, docId);

  // Backfill only: Grab went native (~Jun 17) AFTER the till cutovers, so for
  // historical cut-over days Grab still flowed through StoreHub. Fold those
  // StoreHub delivery-channel archive rows into grabfood — UNLESS the day
  // already has native Grab in pos_orders (counted above; avoid double). For
  // current dates StoreHub is empty, so this adds nothing.
  if (opts.includeStorehubDelivery) {
    const hasNativeGrab = orders.some((o) => classifySourceOverride(o.source) === "grabfood");
    if (!hasNativeGrab) {
      const shRows = await prisma.$queryRaw<Array<{ total: number | null }>>`
        SELECT total FROM storehub_sales
        WHERE outlet_id = ${outletId}
          AND NOT is_cancelled
          AND channel IN ('GRABFOOD', 'BEEP_ORDERS')
          AND transaction_time >= ${from} AND transaction_time <= ${to}
      `;
      const shNet = round2(shRows.reduce((s, r) => s + Number(r.total ?? 0), 0));
      if (shNet > 0) {
        summary.channels.grabfood = round2(summary.channels.grabfood + shNet);
        summary.netSales = round2(summary.netSales + shNet);
        summary.transactions += shRows.length;
      }
    }
  }

  if (summary.netSales <= 0) {
    return { outletId, outletName, date, transactionsFetched: orders.length, skipped: "zero net sales" };
  }

  try {
    const result = await postDailyAr(summary);
    return {
      outletId, outletName, date, transactionsFetched: orders.length,
      posted: { transactionId: result.transactionId, amount: result.amount },
    };
  } catch (err) {
    return {
      outletId, outletName, date, transactionsFetched: orders.length,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// True if `date` (YYYY-MM-DD, MYT) is on/after the outlet's POS-native cutover.
// Cutover is stored at midnight MYT, so a date-string compare is exact.
export function isNativeOnDate(date: string, cutoverAt: Date | null): boolean {
  if (!cutoverAt) return false;
  const cutoverDateMyt = new Date(cutoverAt.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return date >= cutoverDateMyt;
}

// Cron entrypoint: ingest every ACTIVE outlet for `date`, routing each to the
// POS that owned it that day — native on/after cutover, StoreHub before. Once
// every outlet has cut over, this is fully native and StoreHub is never called.
export async function ingestEodForDate(date: string): Promise<IngestEodResult[]> {
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, name: true, storehubId: true,
      posNativeCutoverAt: true, loyaltyOutletId: true, pickupStoreId: true,
    },
  });

  const results: IngestEodResult[] = [];
  for (const o of outlets) {
    if (isNativeOnDate(date, o.posNativeCutoverAt)) {
      results.push(await ingestOutletNativeEod(o, date));
    } else if (o.storehubId) {
      results.push(await ingestOutletEod(o.id, date)); // historical / pre-cutover
    }
    // else: outlet has neither a cutover nor StoreHub on this date → no source, skip.
  }
  return results;
}
