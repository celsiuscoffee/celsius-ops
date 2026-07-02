import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireStaffSession } from "@/lib/staff-token";

// GET /api/staff/availability?store=shah-alam
export async function GET(request: NextRequest) {
  const { error: authError } = requireStaffSession(request, "staff/availability GET");
  if (authError) return authError;

  const storeId = request.nextUrl.searchParams.get("store");
  if (!storeId) return NextResponse.json({ error: "Missing store" }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("product_overrides")
    .select("product_id, is_available")
    .eq("store_id", storeId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// PUT /api/staff/availability  { productId, storeId, isAvailable }
export async function PUT(request: NextRequest) {
  const { error: authError } = requireStaffSession(request, "staff/availability PUT");
  if (authError) return authError;

  const { productId, storeId, isAvailable } = await request.json() as {
    productId:   string;
    storeId:     string;
    isAvailable: boolean;
  };

  if (!productId || !storeId) {
    return NextResponse.json({ error: "Missing productId or storeId" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("product_overrides")
    .upsert(
      { product_id: productId, store_id: storeId, is_available: isAvailable, updated_at: new Date().toISOString() },
      { onConflict: "product_id,store_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
