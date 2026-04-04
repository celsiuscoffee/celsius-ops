import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/pickup/supabase";

/**
 * GET /api/pickup/customers
 *
 * Returns paginated customers from the loyalty app's `members` table
 * (shared Supabase DB).  Enriches each member with:
 *   - current_points  -- latest balance_after from point_transactions
 *   - order_count     -- count of orders in our orders table (matched by customer_phone)
 *
 * Query params:
 *   page   -- 1-indexed page number (default 1)
 *   limit  -- rows per page (default 25)
 *   search -- partial match on phone or name
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const page   = Math.max(1, parseInt(searchParams.get("page")  ?? "1",  10));
  const limit  = Math.min(100, parseInt(searchParams.get("limit") ?? "25", 10));
  const search = (searchParams.get("search") ?? "").trim();
  const from   = (page - 1) * limit;
  const to     = from + limit - 1;

  const supabase = getSupabaseAdmin();

  // 1. Fetch members (paginated, optional search)
  let query = supabase
    .from("members")
    .select("id, phone, name, email, birthday, preferred_outlet_id, tags, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`phone.ilike.%${search}%,name.ilike.%${search}%`);
  }

  const { data: members, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const memberList = members ?? [];

  if (memberList.length === 0) {
    return NextResponse.json({ customers: [], total: count ?? 0, page, limit });
  }

  const memberIds = memberList.map((m) => m.id as string);

  // 2. Get current points balance for each member
  const { data: txRows } = await supabase
    .from("point_transactions")
    .select("member_id, balance_after, created_at")
    .in("member_id", memberIds)
    .order("created_at", { ascending: false });

  const latestBalance = new Map<string, number>();
  for (const tx of (txRows ?? [])) {
    if (!latestBalance.has(tx.member_id as string)) {
      latestBalance.set(tx.member_id as string, tx.balance_after as number ?? 0);
    }
  }

  // 3. Get order counts from our orders table
  const phones = memberList
    .map((m) => m.phone as string)
    .filter(Boolean);

  const { data: orderRows } = await supabase
    .from("orders")
    .select("customer_phone")
    .in("customer_phone", phones)
    .neq("status", "failed");

  const orderCount = new Map<string, number>();
  for (const o of (orderRows ?? [])) {
    const p = o.customer_phone as string;
    orderCount.set(p, (orderCount.get(p) ?? 0) + 1);
  }

  // 4. Merge & return
  const customers = memberList.map((m) => ({
    id:                   m.id,
    phone:                m.phone,
    name:                 m.name,
    email:                m.email,
    birthday:             m.birthday,
    preferred_outlet_id:  m.preferred_outlet_id,
    tags:                 m.tags,
    created_at:           m.created_at,
    current_points:       latestBalance.get(m.id as string) ?? 0,
    order_count:          orderCount.get(m.phone as string) ?? 0,
  }));

  return NextResponse.json({ customers, total: count ?? 0, page, limit });
}
