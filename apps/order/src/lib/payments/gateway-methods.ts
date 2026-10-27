export type GatewayProvider = "stripe" | "revenue_monster" | "ntt_data";

export type GatewayMethod = {
  method_id: string;
  enabled: boolean;
  provider: GatewayProvider;
};

/**
 * Single source of truth for default per-method gateway routing, applied
 * only when the `payment_gateway_config` table is empty (fresh DB). BOTH
 * the customer-facing `/api/payments/gateway-config` (which the native and
 * web clients render) and the server-side `/api/checkout/initiate` router
 * read this, so the two can never disagree.
 *
 * Routing intent: All payment methods route through NTT Data (merchant-specific).
 * Apple/Google Pay and GrabPay also stay on Stripe as fallback for wallet sheets.
 * Once a row exists for a method, the backoffice toggle in /pickup/settings is authoritative.
 */
export const DEFAULT_GATEWAY_METHODS: GatewayMethod[] = [
  { method_id: "card",       enabled: true,  provider: "ntt_data" },
  { method_id: "apple_pay",  enabled: true,  provider: "stripe" },
  { method_id: "google_pay", enabled: true,  provider: "stripe" },
  { method_id: "fpx",        enabled: true,  provider: "ntt_data" },
  { method_id: "grabpay",    enabled: true,  provider: "stripe" },
  { method_id: "tng",        enabled: true,  provider: "ntt_data" },
  { method_id: "boost",      enabled: true,  provider: "ntt_data" },
  { method_id: "shopeepay",  enabled: true,  provider: "ntt_data" },
  { method_id: "duitnow",    enabled: false, provider: "ntt_data" },
];

/** Customer-facing order: Online Banking, e-wallets, card, platform wallets. */
export const METHOD_ORDER = ["fpx", "tng", "boost", "shopeepay", "grabpay", "duitnow", "card", "apple_pay", "google_pay"];

/**
 * Default provider→method sets (enabled methods only) for server-side
 * routing in `initiate`, derived from DEFAULT_GATEWAY_METHODS.
 */
export function defaultMethodSets(): { stripe: Set<string>; rm: Set<string>; ntt_data: Set<string> } {
  const stripe = new Set<string>();
  const rm = new Set<string>();
  const ntt_data = new Set<string>();
  for (const m of DEFAULT_GATEWAY_METHODS) {
    if (!m.enabled) continue;
    if (m.provider === "stripe") stripe.add(m.method_id);
    else if (m.provider === "revenue_monster") rm.add(m.method_id);
    else if (m.provider === "ntt_data") ntt_data.add(m.method_id);
  }
  return { stripe, rm, ntt_data };
}
