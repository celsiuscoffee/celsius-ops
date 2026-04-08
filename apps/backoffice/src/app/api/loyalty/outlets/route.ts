import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    if (!supabaseAdmin) {
      return NextResponse.json([], { status: 200 });
    }

    const brandId = request.nextUrl.searchParams.get("brand_id") || "brand-celsius";

    const { data, error } = await supabaseAdmin
      .from("outlets")
      .select("id, name, code")
      .eq("brand_id", brandId)
      .order("name");

    if (error) return NextResponse.json([], { status: 200 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
