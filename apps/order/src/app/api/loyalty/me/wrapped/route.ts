// GET /api/loyalty/me/wrapped?year=2026 — annual recap stats for the
// caller. "Coffee Wrapped" — Spotify-style year-in-review.
//
// Returns null fields when there's no data so the client can render
// "you're still warming up" copy instead of zeros.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";

export async function GET(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : new Date().getFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1)).toISOString();
  const yearEnd   = new Date(Date.UTC(year + 1, 0, 1)).toISOString();

  const supabase = getSupabaseAdmin();

  // Orders this year — pull just what we need.
  const { data: orders } = await supabase
    .from("orders")
    .select("id, total, subtotal, reward_discount_amount, discount_amount, store_id, created_at")
    .eq("loyalty_id", r.member.memberId)
    .in("status", ["preparing", "ready", "completed"])
    .gte("created_at", yearStart)
    .lt("created_at", yearEnd);

  const totalOrders = orders?.length ?? 0;
  let totalSpent = 0;
  let totalSaved = 0;
  const outletCounts: Record<string, number> = {};
  const monthCounts: number[] = Array(12).fill(0);
  const hourCounts: number[] = Array(24).fill(0);

  for (const o of orders ?? []) {
    totalSpent += (o.total as number) ?? 0;
    totalSaved += ((o.reward_discount_amount as number) ?? 0) + ((o.discount_amount as number) ?? 0);
    if (o.store_id) outletCounts[o.store_id as string] = (outletCounts[o.store_id as string] ?? 0) + 1;
    const d = new Date(o.created_at as string);
    monthCounts[d.getUTCMonth()]++;
    hourCounts[d.getUTCHours()]++;
  }

  // Order items — top product + categories tried.
  let topProductName: string | null = null;
  let topProductCount = 0;
  let distinctProducts = 0;
  if (orders && orders.length > 0) {
    const orderIds = orders.map((o) => o.id as string);
    const { data: items } = await supabase
      .from("order_items")
      .select("product_id, product_name")
      .in("order_id", orderIds);

    const productCounts: Record<string, { name: string; count: number }> = {};
    for (const i of items ?? []) {
      const id = i.product_id as string;
      if (!productCounts[id]) productCounts[id] = { name: (i.product_name as string) ?? "Drink", count: 0 };
      productCounts[id].count++;
    }
    distinctProducts = Object.keys(productCounts).length;
    const top = Object.values(productCounts).sort((a, b) => b.count - a.count)[0];
    if (top) { topProductName = top.name; topProductCount = top.count; }
  }

  // Vouchers redeemed this year.
  const { data: redeemed } = await supabase
    .from("issued_rewards")
    .select("id", { count: "exact", head: false })
    .eq("member_id", r.member.memberId)
    .eq("status", "used")
    .gte("redeemed_at", yearStart)
    .lt("redeemed_at", yearEnd);

  // Longest streak — pull from user_streaks (lifetime max).
  const { data: streak } = await supabase
    .from("user_streaks")
    .select("longest_streak_weeks")
    .eq("member_id", r.member.memberId)
    .maybeSingle();

  // Favorite hour bucket
  let favoriteHour: number | null = null;
  let favoriteHourCount = 0;
  for (let h = 0; h < 24; h++) {
    if (hourCounts[h] > favoriteHourCount) { favoriteHour = h; favoriteHourCount = hourCounts[h]; }
  }

  // Favorite month
  let favoriteMonth: number | null = null;
  let favoriteMonthCount = 0;
  for (let m = 0; m < 12; m++) {
    if (monthCounts[m] > favoriteMonthCount) { favoriteMonth = m + 1; favoriteMonthCount = monthCounts[m]; }
  }

  const distinctOutlets = Object.keys(outletCounts).length;

  return NextResponse.json({
    year,
    summary: {
      total_orders: totalOrders,
      total_spent_sen: totalSpent,
      total_saved_sen: totalSaved,
      distinct_outlets: distinctOutlets,
      distinct_products: distinctProducts,
      vouchers_redeemed: redeemed?.length ?? 0,
      longest_streak_weeks: (streak?.longest_streak_weeks as number) ?? 0,
    },
    favorites: {
      product_name: topProductName,
      product_count: topProductCount,
      hour: favoriteHour,
      month: favoriteMonth,
    },
  });
}
