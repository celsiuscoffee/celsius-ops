export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { checkCronAuth } from "@celsius/shared";

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
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  try {
    const supabase = getSupabaseAdmin();

    // Fetch outlet_hours config + the per-outlet manual override map.
    // outlet_open_override is { [storeId]: true } for outlets the
    // backoffice has manually toggled — we skip those so the schedule
    // doesn't undo an admin's decision (e.g. early close for low staff).
    const [{ data: hoursRow, error: hoursError }, { data: overrideRow }] =
      await Promise.all([
        supabase
          .from("app_settings")
          .select("value")
          .eq("key", "outlet_hours")
          .maybeSingle(),
        supabase
          .from("app_settings")
          .select("value")
          .eq("key", "outlet_open_override")
          .maybeSingle(),
      ]);

    if (hoursError || !hoursRow) {
      return NextResponse.json({ updated: [], message: "No outlet_hours config found" });
    }

    const hoursMap = hoursRow.value as OutletHoursMap;
    let overrideMap =
      (overrideRow?.value as Record<string, boolean> | undefined) ?? {};

    // Current Malaysia time (UTC+8)
    const nowUtc  = new Date();
    const mySecs  = nowUtc.getTime() + 8 * 60 * 60 * 1000;
    const myDate  = new Date(mySecs);
    // getDay() returns 0=Sunday ... 6=Saturday; convert to 1=Monday ... 7=Sunday
    const rawDay  = myDate.getUTCDay(); // 0=Sun
    const dayNum  = rawDay === 0 ? 7 : rawDay; // 1=Mon … 7=Sun
    const currentMinutes = myDate.getUTCHours() * 60 + myDate.getUTCMinutes();

    // ── Daily override reset ─────────────────────────────────────────────
    // A manual pause means "closed for the REST OF TODAY", not forever: a
    // pause set during an outage used to survive until someone remembered
    // "Resume schedule" (one outlet once sat paused for 11 days, silently
    // rejecting online orders every morning). Any tick in the pre-open
    // 05:30–06:30 MYT window wipes the map, so every outlet starts the day
    // back on schedule control. Idempotent — clearing twice is harmless.
    const RESET_START_MIN = 5 * 60 + 30, RESET_END_MIN = 6 * 60 + 30;
    let overridesCleared: string[] = [];
    if (
      currentMinutes >= RESET_START_MIN &&
      currentMinutes < RESET_END_MIN &&
      Object.keys(overrideMap).length > 0
    ) {
      overridesCleared = Object.keys(overrideMap);
      const { error: clearErr } = await supabase
        .from("app_settings")
        .upsert(
          { key: "outlet_open_override", value: {}, updated_at: nowUtc.toISOString() },
          { onConflict: "key" },
        );
      if (clearErr) {
        // Couldn't clear → keep honouring the stored overrides this tick and
        // retry on the next one (still inside the window every 10 min).
        console.error("[auto-hours] override reset failed:", clearErr);
        overridesCleared = [];
      } else {
        console.warn(`[auto-hours] daily override reset: released ${overridesCleared.join(", ")}`);
        overrideMap = {};
      }
    }

    const updated: string[] = [];
    const skipped: string[] = [];

    for (const [storeId, hours] of Object.entries(hoursMap)) {
      // Manual override wins FOR THE REST OF THE DAY. The backoffice / POS
      // toggle sets this flag when an outlet is flipped open/closed
      // mid-schedule, so the next cron tick doesn't undo that decision. It
      // clears via "Resume schedule" in /pickup/settings, re-opening from the
      // till, or automatically at the daily 05:30–06:30 MYT reset above.
      if (overrideMap[storeId] === true) {
        skipped.push(`${storeId}=override`);
        continue;
      }

      const openMins  = timeToMinutes(hours.open);
      const closeMins = timeToMinutes(hours.close);

      // Overnight schedules — close time is past midnight (e.g. 08:00 →
      // 02:00 AM). When close <= open we treat the window as spanning
      // into the next calendar day, so we check two windows:
      //
      //   1. Today's evening: started at open today, still rolling.
      //      Requires today to be an open day and time >= openMins.
      //
      //   2. Yesterday's carryover: yesterday opened, we're still inside
      //      the post-midnight tail. Requires yesterday to be an open
      //      day and time < closeMins.
      //
      // Same-day schedules (close > open) use the original single
      // inclusive-exclusive check.
      const yesterdayNum = dayNum === 1 ? 7 : dayNum - 1;
      const isOvernight  = closeMins <= openMins;

      let isOpen: boolean;
      if (isOvernight) {
        const inTodayEvening    =
          hours.daysOpen.includes(dayNum) && currentMinutes >= openMins;
        const inYesterdayTail   =
          hours.daysOpen.includes(yesterdayNum) && currentMinutes < closeMins;
        isOpen = inTodayEvening || inYesterdayTail;
      } else {
        isOpen =
          hours.daysOpen.includes(dayNum) &&
          currentMinutes >= openMins &&
          currentMinutes < closeMins;
      }

      // Writes target the underlying `Outlet` table (camelCase), not
      // the `outlet_settings` view. The view wraps `isOpen` in a
      // COALESCE("isOpen", false) which Postgres treats as not
      // auto-updatable — PATCHing the view returns HTTP 400 silently.
      // The pickup-native read path through outlet_settings still sees
      // the new value because the view selects directly from this row.
      // storeId in this codebase is the customer-facing `pickupStoreId`
      // (e.g. "conezion"), which is also what the view aliases to
      // `store_id`, so the eq() filter matches one-to-one with the
      // view's store_id.
      const { error } = await supabase
        .from("Outlet")
        .update({ isOpen, updatedAt: new Date().toISOString() })
        .eq("pickupStoreId", storeId);

      if (!error) {
        updated.push(`${storeId}=${isOpen ? "open" : "closed"}`);
      }
    }

    return NextResponse.json({ updated, skipped, overridesCleared });
  } catch (err) {
    console.error("Auto-hours cron error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
