// Unified sales source for the sales dashboard during/after the StoreHub →
// POS-native migration. Per outlet, merges:
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

export type UnifiedSale = {
  ts: string; // ISO timestamp (UTC, with Z) — consumed by getMYTHour/getMYTDateStr
  total: number; // RM
  channel: "dine_in" | "takeaway" | "delivery";
  isDeliveryQR: boolean;
  channelLabel: string; // raw channel/order_type for the channelBreakdown report
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
    });
  };

  // ── StoreHub PAST — local archive up to today 00:00 MYT (today is the live
  // pull below). pushArchive applies the cutover rule per row: all rows
  // pre-cutover, delivery-only post-cutover. ──
  const archiveTo = new Date(Math.min(to.getTime(), todayStartMyt.getTime() - 1));
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
        AND transaction_time IS NOT NULL
        AND transaction_time >= ${from}
        AND transaction_time <= ${archiveTo}
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
      Array<{ ts: Date; total: unknown; source: string | null; order_type: string | null }>
    >`
      SELECT created_at AS ts, total, source, order_type
      FROM pos_orders
      WHERE outlet_id = ${outlet.loyaltyOutletId}
        AND status = 'completed'
        AND created_at >= ${from}
        AND created_at <= ${to}
        ${cutoverFloor}
    `;
    for (const r of posRows) {
      sales.push({
        ts: toISO(r.ts),
        total: (Number(r.total) || 0) / 100, // pos_orders.total is in sen
        channel: posChannel(r.order_type, r.source),
        isDeliveryQR: posIsDeliveryQR(r.order_type, r.source),
        channelLabel: r.source && r.source !== "pos" ? r.source : (r.order_type ?? "pos"),
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
      Array<{ ts: Date; total: unknown; source: string | null; order_type: string | null }>
    >`
      SELECT created_at AS ts, total, source, order_type
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
      });
    }
  }

  return sales;
}
