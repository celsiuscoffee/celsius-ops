import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const revalidate = 30; // Cache 30 seconds

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("outlet_settings")
      .select("store_id, name, address, lat, lng, is_open, is_busy, pickup_time_mins")
      .eq("is_active", true)
      .order("store_id");

    if (error || !data) {
      return NextResponse.json([]);
    }

    const stores = data.map((row) => ({
      id:         row.store_id as string,
      name:       row.name as string,
      address:    row.address as string,
      lat:        row.lat as number,
      lng:        row.lng as number,
      isOpen:     row.is_open as boolean,
      isBusy:     row.is_busy as boolean,
      pickupTime: `~${(row.pickup_time_mins as number)} min`,
    }));

    return NextResponse.json(stores);
  } catch {
    return NextResponse.json([]);
  }
}
