import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/pos/table-qr?outlet={loyaltyOutletId}
 *
 * Returns the tables to print QR codes for — pulled from the SAME source the
 * floor-plan editor writes (pos_branch_settings.table_layout) — plus the store
 * slug used in the customer-facing QR URL. This consolidates the QR generator
 * with the table layout: a table created in the floor plan auto-appears here,
 * so the two are never out of sync. The page calls this via adminFetch (session
 * cookie); reads run under service-role so RLS never blocks the lookup.
 */

// outlet_settings is the canonical loyalty-id → store-slug map, but guarantee
// the four known outlets resolve even before a settings row exists.
const STORE_SLUG: Record<string, string> = {
  "outlet-sa": "shah-alam",
  "outlet-con": "conezion",
  "outlet-tam": "tamarind",
  "outlet-nilai": "nilai",
};

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const outletId = request.nextUrl.searchParams.get("outlet") || "";
  if (!outletId) return NextResponse.json({ error: "Missing outlet" }, { status: 400 });

  const supabase = getSupabaseAdmin();

  // Store slug for the QR URL (/table/{slug}/{label}).
  const { data: os } = await supabase
    .from("outlet_settings").select("store_id")
    .eq("loyalty_outlet_id", outletId).maybeSingle();
  const storeId = (os as { store_id?: string } | null)?.store_id || STORE_SLUG[outletId] || outletId;

  // Tables straight from the saved floor plan (flattened across floors).
  const { data: settings } = await supabase
    .from("pos_branch_settings").select("table_layout")
    .eq("outlet_id", outletId).maybeSingle();
  const layout = (settings as { table_layout?: unknown } | null)?.table_layout;

  const tables: { label: string; floor: string }[] = [];
  if (Array.isArray(layout)) {
    for (const f of layout as Array<{ name?: string; tables?: unknown }>) {
      const floor = (typeof f?.name === "string" && f.name.trim()) || "Floor";
      if (Array.isArray(f?.tables)) {
        for (const t of f.tables as Array<Record<string, unknown>>) {
          const label = String(t?.label ?? "").trim();
          if (label) tables.push({ label, floor });
        }
      }
    }
  }

  return NextResponse.json({ storeId, tables });
}
