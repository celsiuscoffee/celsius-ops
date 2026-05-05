export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { checkCronAuth } from "@celsius/shared";

// Runs every 15 minutes. Marks any "pending" order older than 10 minutes as "failed".
// This cleans up abandoned payments (user left FPX page, browser closed, etc.).
// reconcile-pending runs every 5 min and resolves Stripe-known cases earlier.

export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  try {
    const supabase = getSupabaseAdmin();
    const cutoff   = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago

    const { data, error } = await supabase
      .from("orders")
      .update({ status: "failed" })
      .eq("status", "pending")
      .lt("created_at", cutoff)
      .select("id, order_number");

    if (error) throw error;

    const expired = data ?? [];
    console.log(`[expire-orders] Expired ${expired.length} orders:`, expired.map((o) => o.order_number));

    return NextResponse.json({ expired: expired.length, orders: expired.map((o) => o.order_number) });
  } catch (err) {
    console.error("[expire-orders] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
