// Unified sales source for the sales dashboard during/after the StoreHub →
// POS-native migration. Per outlet, reads:
//   • StoreHub archive (storehub_sales) for transactions BEFORE the outlet's
//     posNativeCutoverAt (or ALL of them if the outlet hasn't cut over yet)
//   • POS-native (pos_orders) for transactions AT/AFTER the cutover
// so every sale is counted exactly once, from the authoritative source for its
// own timestamp. No live StoreHub API calls — everything reads the local DB,
// which is what lets StoreHub be cancelled once all outlets have cut over.

import { prisma } from "@/lib/prisma";
import type { StoreHubTransaction } from "@/lib/storehub";
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
  loyaltyOutletId: string | null; // → pos_orders.outlet_id (e.g. "outlet-con")
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
 */
export async function getUnifiedSalesForOutlet(
  outlet: OutletSource,
  from: Date,
  to: Date,
): Promise<UnifiedSale[]> {
  const sales: UnifiedSale[] = [];

  // ── StoreHub archive ──
  // Pre-cutover: keep everything. Post-cutover: keep only EXTERNAL/online orders
  // (Grab, Beep, … — they carry a `channel`), because those still route through
  // StoreHub until the POS-native Grab integration goes live. Drop post-cutover
  // direct/till sales (no channel) — those are on POS-native now (counted below),
  // so keeping them would double-count.
  const shRows = await prisma.$queryRaw<Array<{ ts: Date; total: unknown; raw: StoreHubTransaction }>>`
    SELECT transaction_time AS ts, total, raw
    FROM storehub_sales
    WHERE outlet_id = ${outlet.outletId}
      AND NOT is_cancelled
      AND transaction_time IS NOT NULL
      AND transaction_time >= ${from}
      AND transaction_time <= ${to}
  `;
  for (const r of shRows) {
    const raw = r.raw;
    const ts = toISO(r.ts);
    if (outlet.cutoverAt && new Date(ts).getTime() >= outlet.cutoverAt.getTime()) {
      const hasChannel = typeof raw?.channel === "string" && raw.channel.trim() !== "";
      if (!hasChannel) continue; // post-cutover direct/till → now on POS-native
    }
    sales.push({
      ts,
      total: Number(r.total) || 0,
      channel: classifyChannel(raw),
      isDeliveryQR: isDeliveryOrQR(raw),
      channelLabel: (raw?.channel ?? "(direct)") as string,
    });
  }

  // ── POS-native — everything AT/AFTER cutover (only once the outlet cut over) ──
  if (outlet.cutoverAt && outlet.loyaltyOutletId) {
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

  return sales;
}
