import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

// GET /api/loyalty/tiers — all active tiers for the brand, ordered by
// sort_order. Powers the account-screen membership carousel (same
// public.tiers rows apps/pickup-native/app/account.tsx reads directly
// via Supabase; the web client can't hit Supabase so it proxies here).
export const revalidate = 300;

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("tiers")
      .select(
        "id,slug,name,min_visits,min_spend,multiplier,color,icon,benefits,qualification_metric,sort_order,discount_percent,invitation_only",
      )
      .eq("brand_id", BRAND_ID)
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ tiers: data ?? [] });
  } catch (err) {
    console.error("Get tiers error:", err);
    return NextResponse.json({ error: "Failed to fetch tiers" }, { status: 500 });
  }
}
