// Order-channel classification — shared by the Members list aggregates and
// the Customer-360 detail route so both label a member's order origins the
// same way. A "channel" is how the order reached us:
//
//   app     — placed inside the native iOS/Android app (orders.source =
//             app_ios | app_android). Forward-only: nothing is tagged app
//             until the native client + /api/orders source-tagging ship, so
//             this bucket is empty for historical orders.
//   web     — placed on the ordering website / PWA (pickup flow, source web
//             or null).
//   qr      — placed by scanning a table QR (orders.source = web_qr, or a
//             dine_in order_type).
//   instore — rung up at the counter POS (pos_orders).
//
// Keep CHANNELS in sync with the filter dropdown in the Members page.

export type OrderChannel = "app" | "web" | "qr" | "instore";

export const CHANNEL_LABELS: Record<OrderChannel, string> = {
  app: "Native app",
  web: "Website / PWA",
  qr: "Table QR",
  instore: "In-store counter",
};

/** Classify a pickup/online `orders` row by its source + order_type. */
export function classifyOrderChannel(
  source: string | null | undefined,
  orderType: string | null | undefined,
): OrderChannel {
  const s = (source ?? "").toLowerCase();
  if (s === "app_ios" || s === "app_android") return "app";
  if (s === "web_qr" || orderType === "dine_in") return "qr";
  return "web";
}

/** Counter `pos_orders` rows are always the in-store channel. */
export function posChannel(): OrderChannel {
  return "instore";
}
