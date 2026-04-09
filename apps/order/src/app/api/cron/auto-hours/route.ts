export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

interface StoreHours {
  open: string;
  close: string;
  daysOpen: number[];
}

type OutletHoursMap = Record<string, StoreHours>;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

// GET /api/cron/auto-hours
// Reads outlet_hours from app_settings, checks current Malaysia time (UTC+8),
// and updates outlet_settings.is_open accordingly.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Fetch outlet_hours config
    const { data: settingRow, error: settingError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "outlet_hours")
      .single();

    if (settingError || !settingRow) {
      return NextResponse.json({ updated: [], message: "No outlet_hours config found" });
    }

    const hoursMap = settingRow.value as OutletHoursMap;

    // Current Malaysia time (UTC+8)
    const nowUtc  = new Date();
    const mySecs  = nowUtc.getTime() + 8 * 60 * 60 * 1000;
    const myDate  = new Date(mySecs);
    // getDay() returns 0=Sunday ... 6=Saturday; convert to 1=Monday ... 7=Sunday
    const rawDay  = myDate.getUTCDay(); // 0=Sun
    const dayNum  = rawDay === 0 ? 7 : rawDay; // 1=Mon … 7=Sun
    const currentMinutes = myDate.getUTCHours() * 60 + myDate.getUTCMinutes();

    const updated: string[] = [];

    for (const [storeId, hours] of Object.entries(hoursMap)) {
      const openMins  = timeToMinutes(hours.open);
      const closeMins = timeToMinutes(hours.close);
      const isDayOpen = hours.daysOpen.includes(dayNum);
      const isOpen    = isDayOpen && currentMinutes >= openMins && currentMinutes < closeMins;

      const { error } = await supabase
        .from("outlet_settings")
        .update({ is_open: isOpen, updated_at: new Date().toISOString() })
        .eq("store_id", storeId);

      if (!error) {
        updated.push(`${storeId}=${isOpen ? "open" : "closed"}`);
      }
    }

    return NextResponse.json({ updated });
  } catch (err) {
    console.error("Auto-hours cron error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
