import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireStaffSession } from "@/lib/staff-token";

/**
 * Returns the count of "preparing" orders at a store that are older than
 * a given cutoff. Used by the bottom-nav red dot on non-Orders tabs to
 * surface an overdue indicator without exposing order data to the client.
 *
 *   GET /api/staff/orders/overdue-count?store=X&before=ISO
 */
export async function GET(request: NextRequest) {
  const { error: authError } = requireStaffSession(request, "staff/orders/overdue-count");
  if (authError) return authError;

  const sp = request.nextUrl.searchParams;
  const storeId = sp.get("store");
  const before  = sp.get("before");

  if (!storeId || !before) {
    return NextResponse.json({ error: "Missing store or before" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Filter on prep_started_at (set by the BEFORE-INSERT/UPDATE trigger
  // when status first hits "preparing") instead of created_at, so card
  // orders waiting on Stripe-webhook confirmation don't show as overdue
  // before they've actually entered the kitchen queue.
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("store_id", storeId)
    .eq("status", "preparing")
    .lt("prep_started_at", before);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ count: count ?? 0 });
}
