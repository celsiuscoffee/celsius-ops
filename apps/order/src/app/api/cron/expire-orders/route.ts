export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// Runs every 10 minutes. Marks any "pending" order older than 60 minutes as "failed".
// This cleans up abandoned payments (user left FPX page, browser closed, etc.).

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const cutoff   = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

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
