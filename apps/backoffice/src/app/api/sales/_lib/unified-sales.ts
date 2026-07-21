// Unified sales source for the sales dashboard during/after the StoreHub →
// POS-native migration. Per outlet, merges:
//   • Hubbo: the pre-StoreHub till archive (hubbo_sales) — Putrajaya/Shah Alam
//     history before their Jan 2026 StoreHub start. Strictly before the
//     handover instant; StoreHub owns everything from it.
//   • StoreHub: the local archive (storehub_sales) for HISTORY. Pre-cutover:
//     every row. Post-cutover: ONLY external delivery (Grab/Beep) that was still
//     on StoreHub during the brief window before it went native — the till
//     (OFFLINE_PAYMENTS) is on pos_orders now, so keeping it would double-count.
//     A live "today" pull runs only while the outlet is still pre-cutover.
//   • POS-native (pos_orders) + pickup (orders): real-time, AT/AFTER cutover.
// Each sale is counted once. StoreHub is frozen after the final cutover (no new
// rows) and its Grab never shares a day with native Grab, so no double-count.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getTransactions, type StoreHubTransaction } from "@/lib/storehub";
import { classifyChannel, isDeliveryOrQR } from "./storehub-helpers";
import {
  type SalesSourceKey,
  storehubSource,
  posSource,
  pickupSource,
} from "./source-channels";

export type UnifiedSale = {
  ts: string; // ISO timestamp (UTC, with Z) — consumed by getMYTHour/getMYTDateStr
  total: number; // RM
  channel: "dine_in" | "takeaway" | "delivery";
  isDeliveryQR: boolean;
  channelLabel: string; // raw channel/order_type for the channelBreakdown report
  source: SalesSourceKey; // normalized sales channel (till/grabfood/qr/pickup/…)
  // Raw payment method, where the source records one: POS-native (dominant
  // tender of the order) and pickup app. StoreHub/hubbo/consignment never
  // exposed payment splits → null (payment breakdowns must say so).
  tender: string | null;
  units: number; // count this event contributes to "transactions": 1 per receipt
  // (StoreHub/POS/pickup), or the day's item_count for consignment (daily grain,
  // no receipt count — so AOV reads as avg price per item for those outlets).
};

// Money-received statuses for the pickup/QR `orders` table. Payment is
// confirmed at the pending → paid/preparing transition (markRmOrderPaid /
// confirm-stripe in apps/order), so a paid order still being brewed is already
// revenue — recognise it at payment, not when staff mark it collected.
// `pending` = unpaid checkout, `failed` = never paid; both excluded. The hourly
// sweep-stale-orders cron advances every paid order to `completed` within ~3h,
// so days in the past are unchanged — this only stops "today" lagging behind
// the till by the fulfilment time.
export const PICKUP_PAID_STATUSES = ["paid", "preparing", "ready", "collected", "completed"];

export type OutletSource = {
  outletId: string; // Celsius Outlet.id → storehub_sales.outlet_id
  storehubStoreId: string | null; // Outlet.storehubId → live StoreHub pull for today
  loyaltyOutletId: string | null; // → pos_orders.outlet_id (e.g. "outlet-con")
  pickupStoreId: string | null; // Outlet.pickupStoreId → orders.store_id (pickup app / QR-table)
  cutoverAt: Date | null; // Outlet.posNativeCutoverAt
};

// (cutover routing is applied per-row in getUnifiedSalesForOutlet, not in SQL)

// Hubbo → StoreHub handover instants, per outlet. Hubbo was the till before
// StoreHub; both archives briefly overlap around the switch (SA ran both for
// ~a day), so each system owns an exclusive half: hubbo rows STRICTLY BEFORE
// the instant, StoreHub rows AT/AFTER it. Constants mirror the canonical
// unified_sales VIEW (migration 085) exactly — both systems are retired, so
// these are frozen history, safe to hardcode.
const HUBBO_HANDOVER_AT: Record<string, Date> = {
  "89b19c9f-b1e0-42fe-a404-6d1a472e34c5": new Date("2026-01-02T16:00:00Z"), // Putrajaya (Conezion)
  "b3b6299e-09dc-4f4a-80ef-bbc04316d324": new Date("2026-01-20T16:00:00Z"), // Shah Alam
};

/** Map a POS-native order_type/source to the dashboard's 3 channels. */
function posChannel(orderType: string | null, source: string | null): "dine_in" | "takeaway" | "delivery" {
  const s = (source ?? "").toLowerCase();
  const t = (orderType ?? "").toLowerCase();
  if (/grab|foodpanda|shopee|deliveroo|deliver/.test(s) || t === "delivery") return "delivery";
  if (t === "takeaway" || t === "take_away" || t === "pickup") return "takeaway";
  return "dine_in";
}

/** Delivery-platform or QR-table order (tracked separately, like the StoreHub side). */
function posIsDeliveryQR(orderType: string | null, source: string | null): boolean {
  const s = (source ?? "").toLowerCase();
  const t = (orderType ?? "").toLowerCase();
  return (
    /grab|foodpanda|shopee|deliveroo|deliver/.test(s) ||
    t === "delivery" ||
    s === "qr" || s === "qr_table" || s === "table" || s === "web"
  );
}

const toISO = (ts: unknown): string => (ts instanceof Date ? ts.toISOString() : String(ts));

/** External delivery aggregator still settling through StoreHub (Grab/Beep/
 *  Panda/Shopee) vs the in-store till (OFFLINE_PAYMENTS). Post-cutover only the
 *  former is kept — the till is on pos_orders. Matches the StoreHub raw
 *  `channel` values (GRABFOOD, BEEP_ORDERS, FOODPANDA, SHOPEEFOOD). */
const isExternalDelivery = (channel: string | null | undefined): boolean =>
  !!channel && /grab|panda|shopee|beep|deliver/i.test(channel);

/**
 * All sales for one outlet across [from, to], routed by the outlet's cutover.
 * Returns a flat, source-agnostic list the dashboard aggregates exactly as it
 * did the raw StoreHub transactions.
 *
 * opts.storehubOnly: return ONLY StoreHub-sourced sales (skip POS-native + pickup).
 * Used by the staff app's bridge so it can add its own native pos+pickup WITHOUT
 * double-counting. The backoffice's own dashboard/graph omit the flag = fully unified.
 */
export async function getUnifiedSalesForOutlet(
  outlet: OutletSource,
  from: Date,
  to: Date,
  opts: { storehubOnly?: boolean } = {},
): Promise<UnifiedSale[]> {
  const sales: UnifiedSale[] = [];

  // Today 00:00 MYT as a UTC instant — the boundary between "archive" (past) and
  // "live" (today). transaction_time / created_at are timestamptz (UTC).
  const now = new Date();
  const mytNow = new Date(now.getTime() + 8 * 3600 * 1000);
  const todayStartMyt = new Date(
    Date.UTC(mytNow.getUTCFullYear(), mytNow.getUTCMonth(), mytNow.getUTCDate()) - 8 * 3600 * 1000,
  );

  // StoreHub is HISTORY only. Pre-cutover keep every row; post-cutover keep ONLY
  // external delivery (Grab/Beep) — the till (OFFLINE_PAYMENTS) is on pos_orders
  // now, so keeping it would double-count.
  const cutoverMs = outlet.cutoverAt ? outlet.cutoverAt.getTime() : Number.POSITIVE_INFINITY;
  const keepStorehub = (ts: string, channel: string | null | undefined): boolean =>
    new Date(ts).getTime() < cutoverMs || isExternalDelivery(channel);

  const pushStorehub = (ts: string, total: number, raw: StoreHubTransaction) => {
    if (!keepStorehub(ts, raw?.channel as string | null | undefined)) return;
    sales.push({
      ts,
      total,
      channel: classifyChannel(raw),
      isDeliveryQR: isDeliveryOrQR(raw),
      channelLabel: (raw?.channel ?? "(direct)") as string,
      source: storehubSource(raw?.channel as string | null | undefined),
      tender: null,
      units: 1,
    });
  };

  // Archive rows carry materialized channel_class/is_delivery_qr, so the
  // cutover gate + label come from the `channel` COLUMN (identical to
  // raw.channel — the importer writes it from the same field) and no
  // classification runs per request. Unclassified rows (gap between
  // backfill and importer deploy) fall back to the old raw path.
  type ArchiveRow = {
    ts: Date;
    total: unknown;
    channel: string | null;
    channel_class: "dine_in" | "takeaway" | "delivery" | null;
    is_delivery_qr: boolean | null;
    raw: StoreHubTransaction | null;
  };
  const pushArchive = (r: ArchiveRow) => {
    if (r.channel_class == null) {
      if (r.raw) pushStorehub(toISO(r.ts), Number(r.total) || 0, r.raw);
      return;
    }
    const ts = toISO(r.ts);
    if (!keepStorehub(ts, r.channel)) return;
    sales.push({
      ts,
      total: Number(r.total) || 0,
      channel: r.channel_class,
      isDeliveryQR: r.is_delivery_qr ?? false,
      channelLabel: r.channel ?? "(direct)",
      source: storehubSource(r.channel),
      tender: null,
      units: 1,
    });
  };

  // ── Hubbo PAST — the till BEFORE StoreHub (Putrajaya/Shah Alam, 2025 →
  // Jan 2026). Without this branch any comparison reaching before the outlet's
  // StoreHub start silently read near-zero. Strictly before the handover
  // instant; the StoreHub query below floors at the same instant, so the
  // brief dual-running window is counted exactly once (same split as the
  // canonical unified_sales view). ──
  const hubboHandover = HUBBO_HANDOVER_AT[outlet.outletId];
  if (hubboHandover && from.getTime() < hubboHandover.getTime()) {
    const hubboRows = await prisma.$queryRaw<Array<{ ts: Date; total: unknown }>>`
      SELECT transaction_time AS ts, nett AS total
      FROM hubbo_sales
      WHERE outlet_id = ${outlet.outletId}
        AND NOT is_refund
        AND transaction_time >= ${from}
        AND transaction_time <= ${to}
        AND transaction_time < ${hubboHandover}
    `;
    for (const r of hubboRows) {
      sales.push({
        ts: toISO(r.ts),
        total: Number(r.total) || 0, // hubbo_sales.nett is RM
        channel: "dine_in", // counter till — no order-type data in the archive
        isDeliveryQR: false,
        channelLabel: "counter",
        source: "till",
        tender: null,
        units: 1,
      });
    }
  }

  // ── StoreHub PAST — local archive up to today 00:00 MYT (today is the live
  // pull below). pushArchive applies the cutover rule per row: all rows
  // pre-cutover, delivery-only post-cutover. `status <> 'paymentCancelled'`
  // matches the canonical revenue convention — those rows are NOT flagged
  // is_cancelled and were being counted as revenue (741 rows / RM24.4k,
  // verified 2026-07-18). Floors at the hubbo handover so the dual-running
  // switchover window isn't double-counted now that hubbo is included. ──
  const archiveTo = new Date(Math.min(to.getTime(), todayStartMyt.getTime() - 1));
  const hubboFloor = hubboHandover
    ? Prisma.sql`AND transaction_time >= ${hubboHandover}`
    : Prisma.empty;
  // channel_class / is_delivery_qr are materialized at import (and
  // backfilled) so this no longer ships the heavy `raw` JSONB — only
  // rows that somehow missed classification fall back to it.
  if (archiveTo.getTime() >= from.getTime()) {
    const shRows = await prisma.$queryRaw<Array<ArchiveRow>>`
      SELECT transaction_time AS ts, total, channel, channel_class, is_delivery_qr,
             CASE WHEN channel_class IS NULL THEN raw END AS raw
      FROM storehub_sales
      WHERE outlet_id = ${outlet.outletId}
        AND NOT is_cancelled
        AND (status IS NULL OR status <> 'paymentCancelled')
        AND transaction_time IS NOT NULL
        AND transaction_time >= ${from}
        AND transaction_time <= ${archiveTo}
        ${hubboFloor}
    `;
    for (const r of shRows) pushArchive(r);
  }

  // ── StoreHub TODAY — LIVE pull so today is real-time, but ONLY while the
  // outlet is still pre-cutover (its till is still on StoreHub). After cutover
  // today comes from pos_orders/pickup below. Falls back to the archive if
  // StoreHub is unreachable. ──
  const preCutoverToday = !outlet.cutoverAt || todayStartMyt.getTime() < outlet.cutoverAt.getTime();
  if (preCutoverToday && outlet.storehubStoreId && to.getTime() >= todayStartMyt.getTime()) {
    try {
      const liveTxns = await getTransactions(outlet.storehubStoreId, todayStartMyt, now);
      for (const t of liveTxns) {
        const ts = t.transactionTime ?? t.completedAt ?? t.createdAt;
        if (!ts) continue;
        pushStorehub(ts, typeof t.total === "number" ? t.total : 0, t);
      }
    } catch (e) {
      console.warn(
        `[unified-sales] live StoreHub today failed for ${outlet.outletId}; using archive:`,
        e instanceof Error ? e.message : e,
      );
      const fb = await prisma.$queryRaw<Array<ArchiveRow>>`
        SELECT transaction_time AS ts, total, channel, channel_class, is_delivery_qr,
               CASE WHEN channel_class IS NULL THEN raw END AS raw
        FROM storehub_sales
        WHERE outlet_id = ${outlet.outletId}
          AND NOT is_cancelled
          AND (status IS NULL OR status <> 'paymentCancelled')
          AND transaction_time IS NOT NULL
          AND transaction_time >= ${todayStartMyt}
          AND transaction_time <= ${to}
      `;
      for (const r of fb) pushArchive(r);
    }
  }

  // ── POS-native — native till orders. For a transitioned StoreHub outlet keep
  // only those AT/AFTER its cutover (pre-cutover sales live in the StoreHub
  // archive above, so a floor avoids double-counting). For a native-only outlet
  // — never on StoreHub, no cutover (e.g. Nilai) — there's no archive to clash
  // with, so count EVERY completed order (no floor). ──
  if (!opts.storehubOnly && outlet.loyaltyOutletId) {
    const cutoverFloor = outlet.cutoverAt
      ? Prisma.sql`AND created_at >= ${outlet.cutoverAt}`
      : Prisma.empty;
    const posRows = await prisma.$queryRaw<
      Array<{ id: string; ts: Date; total: unknown; source: string | null; order_type: string | null }>
    >`
      SELECT id, created_at AS ts, total, source, order_type
      FROM pos_orders
      WHERE outlet_id = ${outlet.loyaltyOutletId}
        AND status = 'completed'
        AND refund_of_order_id IS NULL
        AND created_at >= ${from}
        AND created_at <= ${to}
        ${cutoverFloor}
    `;
    // Dominant tender per order (largest payment). ONE batched DISTINCT ON over
    // just these orders' payment rows (order_id-indexed) instead of a correlated
    // subquery per order — the previous shape ran a subselect for every row.
    const tenderByOrder = new Map<string, string | null>();
    if (posRows.length > 0) {
      const payRows = await prisma.$queryRaw<Array<{ order_id: string; payment_method: string | null }>>`
        SELECT DISTINCT ON (order_id) order_id, payment_method
        FROM pos_order_payments
        WHERE order_id IN (${Prisma.join(posRows.map((r) => r.id))})
        ORDER BY order_id, amount DESC NULLS LAST
      `;
      for (const p of payRows) tenderByOrder.set(p.order_id, p.payment_method);
    }
    for (const r of posRows) {
      sales.push({
        ts: toISO(r.ts),
        total: (Number(r.total) || 0) / 100, // pos_orders.total is in sen
        channel: posChannel(r.order_type, r.source),
        isDeliveryQR: posIsDeliveryQR(r.order_type, r.source),
        channelLabel: r.source && r.source !== "pos" ? r.source : (r.order_type ?? "pos"),
        source: posSource(r.order_type, r.source),
        // Dominant tender of the order (split payments attribute the whole
        // order to the largest payment — the By Payment report stays the
        // precise per-payment view)
        tender: tenderByOrder.get(r.id) ?? null,
        units: 1,
      });
    }
  }

  // ── Pickup app (orders table) — the customer ordering app + QR-table scan-&-
  // order. Real-time (local DB). A DISTINCT stream from the till (pos_orders) and
  // StoreHub — pickup orders never land in either, so no double-count. Counts
  // once payment is done (PICKUP_PAID_STATUSES — not just 'completed', which
  // lagged revenue behind the money until staff marked the order collected);
  // all count toward Pickup & Delivery. ──
  if (!opts.storehubOnly && outlet.pickupStoreId) {
    const pickupRows = await prisma.$queryRaw<
      Array<{ ts: Date; total: unknown; source: string | null; order_type: string | null; payment_method: string | null }>
    >`
      SELECT created_at AS ts, total, source, order_type, payment_method
      FROM orders
      WHERE store_id = ${outlet.pickupStoreId}
        AND status IN (${Prisma.join(PICKUP_PAID_STATUSES)})
        AND created_at >= ${from}
        AND created_at <= ${to}
    `;
    for (const r of pickupRows) {
      const ot = (r.order_type ?? "").toLowerCase();
      sales.push({
        ts: toISO(r.ts),
        total: (Number(r.total) || 0) / 100, // orders.total is in sen
        channel: ot === "dine_in" ? "dine_in" : "takeaway",
        isDeliveryQR: true, // pickup-app / QR-table → Pickup & Delivery bucket
        channelLabel: r.source ?? "pickup",
        source: pickupSource(r.source),
        tender: r.payment_method,
        units: 1,
      });
    }
  }

  // ── Consignment — Gyro Gastro (Nilai) & Kiddytopia (IOI Mall) weekly payment
  // advices, digitised from the "Finance GH x Celsius" WhatsApp archive into
  // consignment_sales (daily grain, gross = pre-commission retail). These two
  // outlets have NO till of their own — no StoreHub, no pos_orders, no pickup —
  // so this is their ONLY sales source and can never double-count. Keyed on the
  // Celsius Outlet.id (= consignment_sales.outlet_id), same id used above for
  // the StoreHub archive. `channel` is cafe|buttercream|moreh|bazaar|event|promo
  // — all in-store counter sales, so they map to dine_in. ──
  if (!opts.storehubOnly) {
    const consRows = await prisma.$queryRaw<Array<{ ts: Date; total: unknown; items: unknown; channel: string }>>`
      SELECT ts, gross AS total, item_count AS items, channel FROM (
        SELECT (biz_date + time '12:00') AT TIME ZONE 'Asia/Kuala_Lumpur' AS ts, gross, item_count, channel
        FROM consignment_sales
        WHERE outlet_id = ${outlet.outletId}
      ) c
      WHERE ts >= ${from} AND ts <= ${to}
    `;
    for (const r of consRows) {
      sales.push({
        ts: toISO(r.ts),
        total: Number(r.total) || 0, // consignment_sales.gross is already RM
        channel: "dine_in",
        isDeliveryQR: false,
        channelLabel: r.channel === "cafe" ? "consignment" : r.channel,
        source: "consignment",
        tender: null,
        // No receipt count in the weekly advice — use the day's items sold as the
        // unit count, so "transactions" reflects items and AOV = avg item price.
        units: Number(r.items) || 0,
      });
    }
  }

  return sales;
}
