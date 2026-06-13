// Pure aggregation core for the internal EOD ingestor.
//
// Deliberately free of IO (no prisma, no supabase, no `@/` imports) so the
// money math — sen→RM, SST netting, tender split, sale filtering — is unit
// tested in isolation. The IO shell lives in internal-eod.ts.
//
// `import type` of the AR shapes is erased at build, so this module pulls in
// nothing from agents/ar at runtime.

import type { EodSummary, EodChannelSplit } from "../agents/ar";

type ChannelKey = keyof EodChannelSplit;

// ── Source row shapes (only the columns we read) ────────────────────────────
export type PosOrderRow = {
  id: string;
  status: string | null;
  refund_of_order_id: string | null;
  sst_amount: number | null; // sen
  total: number | null; // sen
  created_at: string;
};
export type PosPaymentRow = {
  order_id: string;
  payment_method: string | null;
  amount: number | null; // sen
  refund_amount: number | null; // sen
};
export type AppOrderRow = {
  id: string;
  status: string | null;
  payment_method: string | null;
  subtotal: number | null; // sen
  sst_amount: number | null; // sen
  total: number | null; // sen
  created_at: string;
};

// ── Money + classification helpers ──────────────────────────────────────────
function senToRm(sen: number): number {
  return Math.round(sen) / 100;
}
function normMethod(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isPosSale(status: string | null, refundOf: string | null): boolean {
  if (refundOf) return false;
  const s = (status || "").toLowerCase();
  return s === "completed" || s === "paid";
}
function isAppSale(status: string | null): boolean {
  const s = (status || "").toLowerCase();
  return s === "paid" || s === "preparing" || s === "ready" || s === "completed" || s === "collected";
}

const CARD_TOKENS = new Set([
  "card", "cardpayment", "debitcard", "creditcard", "visa", "mastercard", "master",
  "amex", "applepay", "googlepay", "samsungpay", "stripe",
]);
const CASHQR_TOKENS = new Set([
  "cash", "qr", "qrcode", "duitnow", "duitnowqr", "maybankqr", "mae", "rm", "revenuemonster",
  "onlinebanking", "fpx", "tng", "touchngo", "touchngoewallet", "tngewallet",
  "grabpay", "boost", "shopeepay", "ewallet", "wallet",
]);

// Map a raw payment method to a COA channel bucket. Unknown / empty methods
// fall to "other", which drops AR confidence and surfaces an exception — we
// want a human to look rather than silently miscode.
export function payBucket(method: string | null | undefined): ChannelKey {
  const m = normMethod(method);
  if (!m) return "other";
  if (CARD_TOKENS.has(m) || m.includes("card")) return "card";
  if (CASHQR_TOKENS.has(m) || m.includes("duitnow") || m.includes("touchngo") || m.includes("wallet") || m.includes("qr")) {
    return "cashQr";
  }
  return "other";
}

// ── Outlet UUID -> POS code / store slug ────────────────────────────────────
export const SLUG_TO_POS: Record<string, string> = {
  "shah-alam": "outlet-sa",
  conezion: "outlet-con",
  tamarind: "outlet-tam",
  nilai: "outlet-nilai",
};
export type OutletRef = { pickupStoreId: string | null; name: string };
function slugForOutlet(o: OutletRef): string | null {
  if (o.pickupStoreId) return o.pickupStoreId;
  const n = (o.name || "").toLowerCase();
  return n.includes("nilai") ? "nilai"
    : n.includes("shah") ? "shah-alam"
    : n.includes("putrajaya") || n.includes("conezion") ? "conezion"
    : n.includes("tamarind") ? "tamarind"
    : null;
}
export function posCodeForOutlet(o: OutletRef): string | null {
  const slug = slugForOutlet(o);
  return slug ? SLUG_TO_POS[slug] ?? null : null;
}

function emptySplit(): EodChannelSplit {
  return { cashQr: 0, card: 0, voucher: 0, grabfood: 0, gastrohub: 0, other: 0 };
}

// ── EOD source routing (StoreHub vs internal) ───────────────────────────────
// MYT calendar date (YYYY-MM-DD) from a Date.
export function mytDateOf(d: Date): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Decide which ingester owns an outlet's EOD for a given date. Cutover is
// day-grained: an outlet is "internal" on and after its cutover DAY. This
// assumes outlets are cut over at a day boundary (posNativeCutoverAt = 00:00
// MYT of the first full POS day); a mid-day cutover would split that day's
// sales across StoreHub (morning) and POS (afternoon) and the day-grained
// journal would only capture the POS side. Set cutover at midnight to avoid it.
//
// Routing is mutually exclusive, so StoreHub and internal can never both post
// for the same outlet/date.
export function eodSourceFor(
  o: { storehubId: string | null; posNativeCutoverAt: Date | null },
  date: string
): "internal" | "storehub" | "skipped" {
  if (o.posNativeCutoverAt && mytDateOf(o.posNativeCutoverAt) <= date) return "internal";
  if (o.storehubId) return "storehub";
  return "skipped";
}

// ── Pure aggregation: rows -> EodSummary (RM) ───────────────────────────────
//
// Net revenue per order is `total - sst` for BOTH sources (so discounts and
// service charge are already reflected). That net is split across COA buckets
// by the order's own tender mix: POS orders by their pos_order_payments rows,
// app orders by their single payment_method. SST is summed authoritatively
// from the order rows, never inferred from payments.
export function aggregateInternalEod(args: {
  companyId: string;
  outletId: string;
  outletName: string;
  date: string; // YYYY-MM-DD (MYT)
  posOrders: PosOrderRow[];
  posPayments: PosPaymentRow[];
  appOrders: AppOrderRow[];
  sourceDocId: string | null;
}): EodSummary {
  const channelsSen = { cashQr: 0, card: 0, voucher: 0, grabfood: 0, gastrohub: 0, other: 0 };
  let netSen = 0;
  let sstSen = 0;
  let txnCount = 0;
  const refIds: string[] = [];

  // Index POS payments by order.
  const paymentsByOrder = new Map<string, PosPaymentRow[]>();
  for (const p of args.posPayments) {
    const list = paymentsByOrder.get(p.order_id) ?? [];
    list.push(p);
    paymentsByOrder.set(p.order_id, list);
  }

  // POS in-store orders.
  for (const o of args.posOrders) {
    if (!isPosSale(o.status, o.refund_of_order_id)) continue;
    const total = Number(o.total ?? 0);
    const sst = Math.max(Number(o.sst_amount ?? 0), 0);
    const orderNet = Math.max(total - sst, 0);
    if (orderNet <= 0 && sst <= 0) continue;
    txnCount += 1;
    refIds.push(o.id);
    sstSen += sst;
    netSen += orderNet;

    const pays = paymentsByOrder.get(o.id) ?? [];
    const weights = pays.map((p) => Math.max(Number(p.amount ?? 0) - Number(p.refund_amount ?? 0), 0));
    const weightSum = weights.reduce((s, w) => s + w, 0);
    if (weightSum <= 0) {
      // No usable payment rows — fall back to cash/QR rather than "other",
      // since a completed POS sale with no recorded tender is a sync gap, not
      // an unknown channel.
      channelsSen.cashQr += orderNet;
      continue;
    }
    for (let i = 0; i < pays.length; i++) {
      if (weights[i] === 0) continue;
      const bucket = payBucket(pays[i].payment_method);
      channelsSen[bucket] += orderNet * (weights[i] / weightSum);
    }
  }

  // Online / pickup app orders (one tender each).
  for (const o of args.appOrders) {
    if (!isAppSale(o.status)) continue;
    const total = Number(o.total ?? 0);
    const sst = Math.max(Number(o.sst_amount ?? 0), 0);
    const orderNet = Math.max(total - sst, 0);
    if (orderNet <= 0 && sst <= 0) continue;
    txnCount += 1;
    refIds.push(o.id);
    sstSen += sst;
    netSen += orderNet;
    channelsSen[payBucket(o.payment_method)] += orderNet;
  }

  const channels = emptySplit();
  for (const k of Object.keys(channelsSen) as ChannelKey[]) {
    channels[k] = senToRm(channelsSen[k]);
  }

  return {
    companyId: args.companyId,
    outletId: args.outletId,
    outletName: args.outletName,
    date: args.date,
    transactions: txnCount,
    netSales: senToRm(netSen),
    sst: senToRm(sstSen),
    discounts: 0, // tracked at line level on the source rows; not needed for the journal
    channels,
    sourceDocId: args.sourceDocId,
    storehubRefIds: refIds, // reused field: internal pos_orders/orders ids for traceability
  };
}
