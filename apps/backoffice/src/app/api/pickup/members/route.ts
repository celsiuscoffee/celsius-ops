import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

/**
 * GET /api/pickup/members
 *
 * Returns paginated loyalty members joined with member_brands for brand-celsius.
 *
 * Query params:
 *   page   -- 1-indexed (default 1)
 *   limit  -- rows per page (default 50, max 100)
 *   search -- partial match on phone or name
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const page   = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10));
  const limit  = Math.min(100, parseInt(searchParams.get("limit") ?? "50", 10));
  const search = (searchParams.get("search") ?? "").trim();
  const from   = (page - 1) * limit;
  const to     = from + limit - 1;

  const supabase = getSupabaseAdmin();

  // 1. Fetch members (paginated, optional search)
  let membersQuery = supabase
    .from("members")
    .select("id, name, phone, email, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    membersQuery = membersQuery.or(`phone.ilike.%${search}%,name.ilike.%${search}%`);
  }

  const { data: members, count, error } = await membersQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const memberList = members ?? [];

  if (memberList.length === 0) {
    return NextResponse.json({ members: [], total: count ?? 0, page, limit });
  }

  const memberIds = memberList.map((m) => m.id as string);

  // 2. Fetch member_brands stats for brand-celsius
  const { data: brandRows, error: brandError } = await supabase
    .from("member_brands")
    .select("member_id, points_balance, total_points_earned, total_points_redeemed, total_visits, total_spent, last_visit_at")
    .eq("brand_id", "brand-celsius")
    .in("member_id", memberIds);

  if (brandError) {
    return NextResponse.json({ error: brandError.message }, { status: 500 });
  }

  const brandMap = new Map<string, typeof brandRows[0]>();
  for (const row of (brandRows ?? [])) {
    brandMap.set(row.member_id as string, row);
  }

  // 3. Merge & return
  const result = memberList.map((m) => {
    const brand = brandMap.get(m.id as string);
    return {
      id:                  m.id,
      name:                m.name,
      phone:               m.phone,
      email:               m.email,
      created_at:          m.created_at,
      points_balance:      brand?.points_balance      ?? 0,
      total_points_earned: brand?.total_points_earned ?? 0,
      total_visits:        brand?.total_visits        ?? 0,
      total_spent:         brand?.total_spent         ?? 0,
      last_visit_at:       brand?.last_visit_at       ?? null,
    };
  });

  result.sort((a, b) => {
    const dateA = a.last_visit_at ? new Date(a.last_visit_at).getTime() : 0;
    const dateB = b.last_visit_at ? new Date(b.last_visit_at).getTime() : 0;
    return dateB - dateA;
  });

  return NextResponse.json({ members: result, total: count ?? 0, page, limit });
}
