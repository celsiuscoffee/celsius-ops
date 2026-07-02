import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireStaffSession } from "@/lib/staff-token";

export async function GET(request: NextRequest) {
  const { error: authError } = requireStaffSession(request, "staff/products");
  if (authError) return authError;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, category, price")
    .eq("is_available", true)
    .order("category")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
