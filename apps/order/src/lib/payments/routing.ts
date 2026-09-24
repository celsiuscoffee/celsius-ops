import { getSupabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_GATEWAY_METHODS, type GatewayMethod, type GatewayProvider } from "./gateway-methods";

/**
 * Which provider processes `methodId` right now, per payment_gateway_config
 * (the /pickup/settings toggle), falling back to DEFAULT_GATEWAY_METHODS when
 * the table is empty. Null when the method is unknown or disabled.
 */
export async function providerForMethod(methodId: string): Promise<GatewayProvider | null> {
  const { data } = await getSupabaseAdmin()
    .from("payment_gateway_config")
    .select("method_id, enabled, provider");
  const rows = data && data.length > 0 ? (data as GatewayMethod[]) : DEFAULT_GATEWAY_METHODS;
  const row = rows.find((r) => r.method_id === methodId);
  return row && row.enabled ? row.provider : null;
}
