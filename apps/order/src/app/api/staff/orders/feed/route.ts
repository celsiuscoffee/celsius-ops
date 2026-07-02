import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireStaffSession } from "@/lib/staff-token";

/**
 * Staff KDS feed — returns full orders + order_items for a given store
 * filtered by status (and optional time window).
 *
 * Server-side / service-role only. Replaces direct anon-key reads from
 * the KDS browser client so we can revoke anon SELECT on the orders
 * table (and stop leaking customer PII through the public anon key).
 *
 *   GET /api/staff/orders/feed?store=X&statuses=preparing,ready
 *   GET /api/staff/orders/feed?store=X&statuses=completed&from=ISO&dir=desc
 */
export async function GET(request: NextRequest) {
  const { error: authError } = requireStaffSession(request, "staff/orders/feed");
  if (authError) return authError;

  const sp = request.nextUrl.searchParams;
  const storeId = sp.get("store");
  if (!storeId) {
    return NextResponse.json({ error: "Missing store" }, { status: 400 });
  }

  const statuses = (sp.get("statuses") ?? "preparing,ready")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (statuses.length === 0) {
    return NextResponse.json({ error: "Empty statuses" }, { status: 400 });
  }

  const from = sp.get("from");                            // ISO timestamp, optional
  const dir  = sp.get("dir") === "desc" ? false : true;   // default ascending

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("store_id", storeId)
    .in("status", statuses)
    .order("created_at", { ascending: dir });

  if (from) query = query.gte("created_at", from);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
