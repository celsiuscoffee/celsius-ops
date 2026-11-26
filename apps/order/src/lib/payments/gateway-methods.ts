export type GatewayProvider = "stripe" | "revenue_monster" | "ipay88";

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
 * Previously `initiate` had its own default that sent card + FPX to Stripe,
 * while `gateway-config` sent them to Revenue Monster — so the web app's
 * card/FPX payments hit Stripe (often unconfigured) and failed, while the
 * native app correctly used Revenue Monster. Sharing this list keeps web
 * and native gateway routing identical.
 *
 * Routing intent: Apple/Google Pay stay on Stripe (only Stripe drives the
 * native iOS/Android wallet sheets) and GrabPay stays on Stripe (strong
 * Stripe MY support); everything else routes through Revenue Monster for
 * direct settlement to the merchant's MY bank account. Once a row exists
 * for a method, the backoffice toggle in /pickup/settings is authoritative.
 */
export const DEFAULT_GATEWAY_METHODS: GatewayMethod[] = [
  { method_id: "card",       enabled: true,  provider: "revenue_monster" },
  { method_id: "apple_pay",  enabled: true,  provider: "stripe" },
  { method_id: "google_pay", enabled: true,  provider: "stripe" },
  { method_id: "fpx",        enabled: true,  provider: "revenue_monster" },
  { method_id: "grabpay",    enabled: true,  provider: "stripe" },
  { method_id: "tng",        enabled: true,  provider: "revenue_monster" },
  { method_id: "boost",      enabled: true,  provider: "revenue_monster" },
  { method_id: "shopeepay",  enabled: true,  provider: "revenue_monster" },
  { method_id: "duitnow",    enabled: false, provider: "revenue_monster" },
];

/** Customer-facing order: Online Banking, e-wallets, card, platform wallets. */
export const METHOD_ORDER = ["fpx", "tng", "boost", "shopeepay", "grabpay", "duitnow", "card", "apple_pay", "google_pay"];

/**
 * Provider→method sets (enabled methods only) for server-side routing,
 * from the payment_gateway_config rows — or DEFAULT_GATEWAY_METHODS when
 * the table is empty.
 */
export function methodSets(rows: GatewayMethod[] | null | undefined): {
  stripe: Set<string>;
  rm: Set<string>;
  ipay88: Set<string>;
} {
  const sets = { stripe: new Set<string>(), rm: new Set<string>(), ipay88: new Set<string>() };
  for (const m of rows && rows.length > 0 ? rows : DEFAULT_GATEWAY_METHODS) {
    if (!m.enabled) continue;
    if (m.provider === "stripe") sets.stripe.add(m.method_id);
    else if (m.provider === "ipay88") sets.ipay88.add(m.method_id);
    else sets.rm.add(m.method_id);
  }
  return sets;
}

/** Default sets for server-side routing in `initiate`. */
export function defaultMethodSets(): { stripe: Set<string>; rm: Set<string>; ipay88: Set<string> } {
  return methodSets(null);
}

/**
 * The provider value clients see. Released native builds (and the web
 * checkout) only know "stripe" (open the Stripe sheet) and "revenue_monster"
 * (call /api/payments/create and open the returned hosted-page URL), and
 * treat anything else as Stripe. iPay88 is a hosted page reached through the
 * same /api/payments/create call, so it is reported as "revenue_monster" —
 * which lets every installed app pay through iPay88 without an app update.
 * The real provider rides along in `gateway` for anything that needs it.
 */
export function clientProvider(p: GatewayProvider): "stripe" | "revenue_monster" {
  return p === "stripe" ? "stripe" : "revenue_monster";
}
