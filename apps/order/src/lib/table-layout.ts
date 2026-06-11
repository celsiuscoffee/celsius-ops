import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Valid table labels for a store, straight from the SAME floor plan the
 * backoffice QR generator prints from (pos_branch_settings.table_layout,
 * keyed by the loyalty outlet id — resolved from outlet_settings).
 *
 * Returns a Set of trimmed labels, or NULL when the outlet has no floor plan
 * with tables configured. Callers must treat null as "don't enforce" — blocking
 * on a missing layout would kill QR ordering for the whole outlet.
 *
 * The QR URL is typeable (/table/{store}/{label}), so this is what stops a
 * customer (or a typo) from ordering against a table that doesn't exist —
 * e.g. the "table 11" order at Putrajaya when the layout has no 11.
 */
export async function fetchValidTableLabels(
  supabase: SupabaseClient,
  storeId: string,
): Promise<Set<string> | null> {
  try {
    const { data: os } = await supabase
      .from("outlet_settings")
      .select("loyalty_outlet_id")
      .eq("store_id", storeId)
      .maybeSingle();
    const loyaltyId = (os as { loyalty_outlet_id?: string | null } | null)?.loyalty_outlet_id;
    if (!loyaltyId) return null;

    const { data: settings } = await supabase
      .from("pos_branch_settings")
      .select("table_layout")
      .eq("outlet_id", loyaltyId)
      .maybeSingle();
    const layout = (settings as { table_layout?: unknown } | null)?.table_layout;
    if (!Array.isArray(layout)) return null;

    const labels = new Set<string>();
    for (const floor of layout as Array<{ tables?: unknown }>) {
      if (!Array.isArray(floor?.tables)) continue;
      for (const t of floor.tables as Array<Record<string, unknown>>) {
        const label = String(t?.label ?? "").trim();
        if (label) labels.add(label);
      }
    }
    return labels.size > 0 ? labels : null;
  } catch {
    // Lookup failure must never block ordering.
    return null;
  }
}
