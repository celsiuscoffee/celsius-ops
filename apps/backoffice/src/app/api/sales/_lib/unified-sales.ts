// Unified sales source for the sales dashboard during/after the StoreHub →
// POS-native migration. Per outlet, merges:
//   • StoreHub: the local archive (storehub_sales) for PAST days + a LIVE pull
//     for TODAY (so today is real-time like the old dashboard, while history
//     stays fast on the DB). Cutover-routed: pre-cutover all channels,
//     post-cutover external/online only (Grab/Beep — still on StoreHub).
//   • POS-native (pos_orders): real-time, for transactions AT/AFTER cutover.
// Each sale is counted once from the authoritative source for its time. The
// live today-pull falls back to the archive if StoreHub is unreachable, and
// disappears per outlet as it cuts over — so StoreHub can still be cancelled
// once it's fully off (all tills + Grab on POS-native).

import { prisma } from "@/lib/prisma";
import { getTransactions, type StoreHubTransaction } from "@/lib/storehub";
import { classifyChannel, isDeliveryOrQR } from "./storehub-helpers";

export type UnifiedSale = {
  ts: string; // ISO timestamp (UTC, with Z) — consumed by getMYTHour/getMYTDateStr
  total: number; // RM
  channel: "dine_in" | "takeaway" | "delivery";
  isDeliveryQR: boolean;
  channelLabel: string; // raw channel/order_type for the channelBreakdown report
};

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

  // Apply cutover routing to one StoreHub txn and push it. Pre-cutover: keep all.
  // Post-cutover: keep only EXTERNAL/online orders (Grab, Beep — they carry a
  // `channel`); drop post-cutover direct/till (no channel) — those are on
  // POS-native now (counted below), so keeping them would double-count.
  const pushStorehub = (ts: string, total: number, raw: StoreHubTransaction) => {
    if (outlet.cutoverAt && new Date(ts).getTime() >= outlet.cutoverAt.getTime()) {
      const hasChannel = typeof raw?.channel === "string" && raw.channel.trim() !== "";
      if (!hasChannel) return;
    }
    sales.push({
      ts,
      total,
      channel: classifyChannel(raw),
      isDeliveryQR: isDeliveryOrQR(raw),
      channelLabel: (raw?.channel ?? "(direct)") as string,
    });
  };

  // ── StoreHub PAST — local archive, up to (not including) today 00:00 MYT ──
  const archiveTo = to.getTime() < todayStartMyt.getTime() ? to : new Date(todayStartMyt.getTime() - 1);
  const shRows = await prisma.$queryRaw<Array<{ ts: Date; total: unknown; raw: StoreHubTransaction }>>`
    SELECT transaction_time AS ts, total, raw
    FROM storehub_sales
    WHERE outlet_id = ${outlet.outletId}
      AND NOT is_cancelled
      AND transaction_time IS NOT NULL
      AND transaction_time >= ${from}
      AND transaction_time <= ${archiveTo}
  `;
  for (const r of shRows) pushStorehub(toISO(r.ts), Number(r.total) || 0, r.raw);

  // ── StoreHub TODAY — LIVE pull so today is real-time (outlets still on
  // StoreHub). Falls back to the archive if StoreHub is unreachable. ──
  if (outlet.storehubStoreId && to.getTime() >= todayStartMyt.getTime()) {
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
      const fb = await prisma.$queryRaw<Array<{ ts: Date; total: unknown; raw: StoreHubTransaction }>>`
        SELECT transaction_time AS ts, total, raw
        FROM storehub_sales
        WHERE outlet_id = ${outlet.outletId}
          AND NOT is_cancelled
          AND transaction_time IS NOT NULL
          AND transaction_time >= ${todayStartMyt}
          AND transaction_time <= ${to}
      `;
      for (const r of fb) pushStorehub(toISO(r.ts), Number(r.total) || 0, r.raw);
    }
  }

  // ── POS-native — everything AT/AFTER cutover (only once the outlet cut over) ──
  if (!opts.storehubOnly && outlet.cutoverAt && outlet.loyaltyOutletId) {
    const posRows = await prisma.$queryRaw<
      Array<{ ts: Date; total: unknown; source: string | null; order_type: string | null }>
    >`
      SELECT created_at AS ts, total, source, order_type
      FROM pos_orders
      WHERE outlet_id = ${outlet.loyaltyOutletId}
        AND status = 'completed'
        AND created_at >= ${from}
        AND created_at <= ${to}
        AND created_at >= ${outlet.cutoverAt}
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
  // StoreHub — pickup orders never land in either, so no double-count. Only paid
  // (status='completed'); all count toward Pickup & Delivery. ──
  if (!opts.storehubOnly && outlet.pickupStoreId) {
    const pickupRows = await prisma.$queryRaw<
      Array<{ ts: Date; total: unknown; source: string | null; order_type: string | null }>
    >`
      SELECT created_at AS ts, total, source, order_type
      FROM orders
      WHERE store_id = ${outlet.pickupStoreId}
        AND status = 'completed'
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
