// Normalized SALES CHANNELS ("which pipe did the order arrive through"),
// orthogonal to the dine-in/takeaway/delivery ORDER-TYPE split the dashboard
// has always shown. One order has both: a GrabFood order is source=grabfood +
// order-type delivery; a QR-table order is source=qr_table + order-type
// dine_in. Keys are stable API values — the compare UI renders SOURCE_LABELS.
//
// Vocabulary verified against prod 2026-07-18:
//   pos_orders.source        → 'pos' | 'grabfood'
//   orders.source (pickup)   → 'web_qr' | 'app_ios' | 'app_android' | 'web' | null
//   storehub_sales.channel   → 'OFFLINE_PAYMENTS' | 'GRABFOOD' | 'BEEP_ORDERS'
//   hubbo_sales              → counter till only
//   consignment_sales        → its own stream

export type SalesSourceKey =
  | "till" // in-store counter POS (hubbo → StoreHub → pos-native eras)
  | "grabfood"
  | "delivery_other" // Beep (retired StoreHub-era) / foodpanda / shopee / other aggregators
  | "qr_table" // scan-&-order at the table (orders.source = web_qr)
  | "pickup_app" // customer ordering app (iOS / Android / web)
  | "consignment"; // Gyro Gastro (Nilai) & Kiddytopia (IOI Mall) settlements

export const SOURCE_LABELS: Record<SalesSourceKey, string> = {
  till: "In-store (Till)",
  grabfood: "GrabFood",
  // Owner-facing name: almost all of this bucket is the retired StoreHub
  // Beep online-ordering channel (May 2026 and earlier); foodpanda/shopee
  // would land here too but were never used.
  delivery_other: "Beep / Other Delivery",
  qr_table: "QR Table",
  pickup_app: "Pickup App",
  consignment: "Consignment",
};

/** Display order for channel tables. */
export const SOURCE_ORDER: SalesSourceKey[] = [
  "till",
  "qr_table",
  "pickup_app",
  "grabfood",
  "delivery_other",
  "consignment",
];

/** StoreHub archive / live rows — keyed off the raw `channel` column.
 *  Beep (BEEP_ORDERS) is retired with StoreHub — owner folds it into
 *  Other Delivery rather than carrying a dead channel row. */
export function storehubSource(channel: string | null | undefined): SalesSourceKey {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("grab")) return "grabfood";
  if (/beep|panda|shopee|deliver/.test(c)) return "delivery_other";
  return "till";
}

/** POS-native rows (pos_orders.source / order_type). */
export function posSource(orderType: string | null, source: string | null): SalesSourceKey {
  const s = (source ?? "").toLowerCase();
  const t = (orderType ?? "").toLowerCase();
  if (s.includes("grab")) return "grabfood";
  if (/panda|shopee|deliveroo/.test(s) || t === "delivery") return "delivery_other";
  if (s === "qr" || s === "qr_table" || s === "table") return "qr_table";
  return "till";
}

/** Pickup-app rows (orders.source). web_qr is the table scan-&-order flow. */
export function pickupSource(source: string | null): SalesSourceKey {
  const s = (source ?? "").toLowerCase();
  return s.includes("qr") ? "qr_table" : "pickup_app";
}
