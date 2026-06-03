import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve the per-outlet SST (checkout tax) for a pickup store slug.
 *
 * SST is configured per outlet on pos_branch_settings (sst_enabled / sst_rate),
 * so every channel — in-store POS, pickup, web, QR-table — charges the SAME tax
 * for a given outlet. The customer app keys orders by store slug ("shah-alam"),
 * which maps to the loyalty outlet id ("outlet-sa") via outlet_settings, which
 * is the pos_branch_settings primary key.
 *
 * Server-authoritative: callers must use this, never a client-supplied rate.
 * No mapping / no row / unset → SST off (safe). `rate` is a fraction (0.06 = 6%).
 */
export async function getOutletSst(
  supabase: SupabaseClient,
  storeId: string | null | undefined,
): Promise<{ enabled: boolean; rate: number }> {
  const fallback = { enabled: false, rate: 0.06 };
  if (!storeId) return fallback;
  try {
    const { data: os } = await supabase
      .from("outlet_settings")
      .select("loyalty_outlet_id")
      .eq("store_id", storeId)
      .maybeSingle();
    const loyaltyOutletId = (os as { loyalty_outlet_id?: string } | null)?.loyalty_outlet_id;
    if (!loyaltyOutletId) return fallback;
    const { data: branch } = await supabase
      .from("pos_branch_settings")
      .select("sst_enabled, sst_rate")
      .eq("outlet_id", loyaltyOutletId)
      .maybeSingle();
    const b = branch as { sst_enabled?: boolean; sst_rate?: number } | null;
    return {
      enabled: b?.sst_enabled === true,
      rate: typeof b?.sst_rate === "number" ? b.sst_rate : 0.06,
    };
  } catch {
    return fallback;
  }
}
