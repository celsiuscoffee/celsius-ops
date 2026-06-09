import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Per-outlet out-of-stock (POS "86") product ids for the customer menu.
 *
 * Server-side (service role) on purpose: every other customer read in this app
 * goes through an /api route, and the order app has no provisioned browser
 * Supabase client — an earlier client-side version of this read silently
 * returned nothing, so a 86 never reached the web menu. Reads the SAME table +
 * store-slug key the POS register writes (/api/pos/availability) and the
 * backoffice Availability matrix edits.
 *
 * GET /api/menu/availability?outlet={storeSlug} -> { oos: string[] }
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const outlet = req.nextUrl.searchParams.get("outlet");
  if (!outlet) return NextResponse.json({ oos: [] });

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("outlet_product_availability")
      .select("product_id")
      .eq("outlet_id", outlet)
      .eq("is_available", false);

    if (error || !data) return NextResponse.json({ oos: [] });

    const res = NextResponse.json({ oos: data.map((d) => d.product_id as string) });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch {
    return NextResponse.json({ oos: [] });
  }
}
