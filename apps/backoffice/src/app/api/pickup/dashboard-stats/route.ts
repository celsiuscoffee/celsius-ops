import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/pickup/dashboard-stats?section=loyalty|inventory
//
// Server-side aggregates for the pickup dashboard's lazy-loaded tabs.
// These reads previously ran in the browser with the anon key and only
// worked because the loyalty tables' RLS policies were USING (true) for
// every role (see docs/rls-access-map-2026-07-05.md, exposure 2). Keeping
// them behind the service-role client lets those policies be tightened
// without breaking the page.
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  const section = request.nextUrl.searchParams.get("section");
  const supabase = getSupabaseAdmin();
  try {
    if (section === "loyalty") {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const [mbRes, rdmRes, totalRes, activeRes, pointsRes] = await Promise.all([
        supabase.from("member_brands")
          .select("points_balance, total_points_earned, last_visit_at, members(name, phone, created_at)")
          .eq("brand_id", "brand-celsius").order("last_visit_at", { ascending: false }).limit(5),
        supabase.from("redemptions").select("id", { count: "exact", head: true }).eq("brand_id", "brand-celsius"),
        supabase.from("member_brands").select("*", { count: "exact", head: true }).eq("brand_id", "brand-celsius"),
        supabase.from("member_brands").select("*", { count: "exact", head: true })
          .eq("brand_id", "brand-celsius").gte("last_visit_at", monthStart.toISOString()),
        supabase.from("member_brands").select("total_points_earned").eq("brand_id", "brand-celsius"),
      ]);
      type MbRow = {
        points_balance: number;
        total_points_earned: number;
        last_visit_at: string | null;
        members: { name: string | null; phone: string; created_at: string } | null;
      };
      const pointsData = pointsRes.data as Array<{ total_points_earned: number }> | null;
      return NextResponse.json({
        totalMembers: totalRes.count ?? 0,
        activeMonth: activeRes.count ?? 0,
        pointsIssued: (pointsData ?? []).reduce((s, m) => s + (m.total_points_earned ?? 0), 0),
        redemptions: rdmRes.count ?? 0,
        recentMembers: ((mbRes.data ?? []) as unknown as MbRow[]).map((m) => ({
          name: m.members?.name ?? null,
          phone: m.members?.phone ?? "",
          joined: m.members?.created_at ?? "",
          points: m.points_balance,
        })),
      });
    }

    if (section === "inventory") {
      const [ingR, lvlR, parR] = await Promise.all([
        supabase.from("ingredients").select("id,name,unit").eq("is_active", true),
        supabase.from("stock_levels").select("ingredient_id,quantity"),
        supabase.from("ingredient_outlet_settings").select("ingredient_id,par_level"),
      ]);
      const ing = (ingR.data ?? []) as Array<{ id: string; name: string; unit: string }>;
      const lvlMap = Object.fromEntries(
        ((lvlR.data ?? []) as Array<{ ingredient_id: string; quantity: number }>).map((l) => [l.ingredient_id, l.quantity]),
      );
      const parMap = Object.fromEntries(
        ((parR.data ?? []) as Array<{ ingredient_id: string; par_level: number }>).map((s) => [s.ingredient_id, s.par_level]),
      );
      const lowItems = ing
        .filter((i) => {
          const qty = lvlMap[i.id] ?? 0;
          const par = parMap[i.id] ?? 0;
          return qty > 0 && par > 0 && qty < par;
        })
        .map((i) => ({ name: i.name, qty: lvlMap[i.id] ?? 0, unit: i.unit }))
        .slice(0, 5);
      return NextResponse.json({
        total: ing.length,
        lowStock: lowItems.length,
        outStock: ing.filter((i) => (lvlMap[i.id] ?? 0) === 0).length,
        lowItems,
      });
    }

    return NextResponse.json({ error: "section must be loyalty or inventory" }, { status: 400 });
  } catch (e) {
    console.error("[pickup/dashboard-stats]", e);
    return NextResponse.json({ error: "failed to load stats" }, { status: 500 });
  }
}
