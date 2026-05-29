import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_GATEWAY_METHODS, METHOD_ORDER, type GatewayProvider } from "@/lib/payments/gateway-methods";

/**
 * GET /api/payments/gateway-config
 *
 * Public read of the per-method gateway routing the backoffice configures
 * at /pickup/settings. Returns only what the customer-facing native app
 * needs to render its payment tiles:
 *
 *   {
 *     paymentsEnabled: boolean,
 *     methods: [
 *       { method_id: "card", enabled: true,  provider: "stripe" },
 *       { method_id: "tng",  enabled: true,  provider: "revenue_monster" },
 *       ...
 *     ]
 *   }
 *
 * The customer never sees the provider — the native app uses it internally
 * to decide whether to open the Stripe sheet or RM's hosted page.
 *
 * Defaults (used only when the table is empty or the row is missing) match
 * the historical "Stripe handles cards + wallets, RM handles MY e-wallets"
 * split that initiate/route.ts also falls back to.
 */

export async function GET() {
  const supabase = getSupabaseAdmin();

  // payments_enabled lives in app_settings as a single { enabled: bool } blob,
  // separate from the per-method routing. Both need to be true for a method
  // to show up to the customer.
  const [{ data: paymentsSetting }, { data: pgRows }] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "payments_enabled")
      .maybeSingle(),
    supabase
      .from("payment_gateway_config")
      .select("method_id, enabled, provider"),
  ]);

  const paymentsEnabled =
    (paymentsSetting?.value as { enabled?: boolean } | null)?.enabled ?? true;

  const dbMethods =
    pgRows && pgRows.length > 0
      ? (pgRows as Array<{ method_id: string; enabled: boolean; provider: GatewayProvider }>)
      : DEFAULT_GATEWAY_METHODS;

  // Stable, customer-facing order. Card first, wallets next, redirects last —
  // matches how most MY F&B apps present payment options.
  const sorted = [...dbMethods].sort(
    (a, b) =>
      (METHOD_ORDER.indexOf(a.method_id) === -1 ? 999 : METHOD_ORDER.indexOf(a.method_id)) -
      (METHOD_ORDER.indexOf(b.method_id) === -1 ? 999 : METHOD_ORDER.indexOf(b.method_id)),
  );

  return NextResponse.json({
    paymentsEnabled,
    methods: sorted,
  });
}
