import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
      // The inventory model lives in Prisma (Product / StockBalance /
      // ParLevel). This branch used to read `ingredients`, `stock_levels`
      // and `ingredient_outlet_settings` through Supabase — tables that do
      // not exist in this database — so the tab always 500'd. Aggregate
      // across outlets: a product is out of stock when it has no quantity
      // anywhere, and low when its total sits under its combined par.
      const [products, balances, pars] = await Promise.all([
        prisma.product.findMany({
          where: { isActive: true, itemType: "INGREDIENT" },
          select: { id: true, name: true, baseUom: true },
          orderBy: { name: "asc" },
        }),
        prisma.stockBalance.groupBy({
          by: ["productId"],
          _sum: { quantity: true },
        }),
        prisma.parLevel.groupBy({
          by: ["productId"],
          _sum: { parLevel: true },
        }),
      ]);
      const qtyMap = new Map(balances.map((b) => [b.productId, Number(b._sum.quantity ?? 0)]));
      const parMap = new Map(pars.map((p) => [p.productId, Number(p._sum.parLevel ?? 0)]));
      const lowItems = products
        .filter((i) => {
          const qty = qtyMap.get(i.id) ?? 0;
          const par = parMap.get(i.id) ?? 0;
          return qty > 0 && par > 0 && qty < par;
        })
        .map((i) => ({ name: i.name, qty: qtyMap.get(i.id) ?? 0, unit: i.baseUom }))
        .slice(0, 5);
      return NextResponse.json({
        total: products.length,
        lowStock: lowItems.length,
        outStock: products.filter((i) => (qtyMap.get(i.id) ?? 0) === 0).length,
        lowItems,
      });
    }

    return NextResponse.json({ error: "section must be loyalty or inventory" }, { status: 400 });
  } catch (e) {
    console.error("[pickup/dashboard-stats]", e);
    return NextResponse.json({ error: "failed to load stats" }, { status: 500 });
  }
}
