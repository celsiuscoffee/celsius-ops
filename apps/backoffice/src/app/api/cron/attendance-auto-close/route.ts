import { NextRequest, NextResponse } from "next/server";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";

// Runs every 5 min via Vercel Cron.
// Auto-closes attendance logs that match any of:
//   A) Last in-zone ping was > geofence_exit_grace_minutes ago
//   B) No ping at all for > auto_close_stale_pings_minutes (staff never opened the app after clock-in)
//   C) Scheduled shift end + auto_close_after_scheduled_end_hours passed
//   D) Outlet closed + auto_close_at_outlet_close_minutes passed
//
// Clock-out time is set to:
//   - For (A) → timestamp of last in-zone ping
//   - For (B), (C), (D) → scheduled end or now (whichever earlier)
//
// ai_flags gets "auto_closed_<reason>" so the manager review queue surfaces these.
export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const now = new Date();

  // Load thresholds
  const { data: settings } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("geofence_exit_grace_minutes, auto_close_stale_pings_minutes, auto_close_after_scheduled_end_hours, auto_close_at_outlet_close_minutes")
    .limit(1)
    .maybeSingle();

  const graceMin = Number(settings?.geofence_exit_grace_minutes ?? 30);
  const staleMin = Number(settings?.auto_close_stale_pings_minutes ?? 90);
  const pastEndHours = Number(settings?.auto_close_after_scheduled_end_hours ?? 2);
  const outletCloseBuffer = Number(settings?.auto_close_at_outlet_close_minutes ?? 30);

  // Active attendance logs
  const { data: activeLogs } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id, user_id, outlet_id, clock_in, scheduled_end, ai_flags")
    .is("clock_out", null);

  if (!activeLogs || activeLogs.length === 0) {
    return NextResponse.json({ processed: 0, closed: 0 });
  }

  // Outlets with closeTime for (D)
  const outletIds = Array.from(new Set(activeLogs.map((l: { outlet_id: string }) => l.outlet_id)));
  const outlets = await prisma.outlet.findMany({
    where: { id: { in: outletIds } },
    select: { id: true, closeTime: true, name: true },
  });
  const outletMap = new Map(outlets.map((o) => [o.id, o]));

  let closed = 0;
  const actions: { logId: string; reason: string; closeAt: string }[] = [];

  for (const log of activeLogs) {
    const clockIn = new Date(log.clock_in);
    const clockInAgeMin = (now.getTime() - clockIn.getTime()) / 60000;
    const flags: string[] = Array.isArray(log.ai_flags) ? [...log.ai_flags] : [];

    // Get last ping (any kind) and last in-zone ping
    const [lastPingResp, lastInZoneResp] = await Promise.all([
      hrSupabaseAdmin.from("hr_attendance_pings").select("created_at").eq("attendance_log_id", log.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      hrSupabaseAdmin.from("hr_attendance_pings").select("created_at").eq("attendance_log_id", log.id).eq("in_zone", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const lastPingAt = lastPingResp.data?.created_at ? new Date(lastPingResp.data.created_at) : null;
    const lastInZoneAt = lastInZoneResp.data?.created_at ? new Date(lastInZoneResp.data.created_at) : null;

    let closeAt: Date | null = null;
    let reason: string | null = null;

    // Rule A: Last in-zone ping was long ago (has pings but stopped being in-zone)
    if (lastInZoneAt && lastPingAt) {
      const inZoneAgoMin = (now.getTime() - lastInZoneAt.getTime()) / 60000;
      if (inZoneAgoMin > graceMin) {
        closeAt = lastInZoneAt;
        reason = "geofence_exit";
      }
    }

    // Rule B: No pings at all + stale
    if (!reason && !lastPingAt && clockInAgeMin > staleMin) {
      closeAt = log.scheduled_end ? new Date(log.scheduled_end) : now;
      if (closeAt > now) closeAt = now;
      reason = "no_pings_stale";
    }

    // Rule C: Past scheduled end + pastEndHours
    if (!reason && log.scheduled_end) {
      const schedEnd = new Date(log.scheduled_end);
      const hoursPastEnd = (now.getTime() - schedEnd.getTime()) / 3600000;
      if (hoursPastEnd > pastEndHours) {
        closeAt = schedEnd;
        reason = "past_scheduled_end";
      }
    }

    // Rule D: Outlet closed + buffer
    if (!reason) {
      const outlet = outletMap.get(log.outlet_id);
      if (outlet?.closeTime) {
        const [ch, cm] = outlet.closeTime.split(":").map(Number);
        const outletCloseToday = new Date(clockIn);
        outletCloseToday.setHours(ch, cm, 0, 0);
        // Handle next-day close (after midnight) — if close is before clock-in, assume next day
        if (outletCloseToday < clockIn) outletCloseToday.setDate(outletCloseToday.getDate() + 1);
        const minsPastClose = (now.getTime() - outletCloseToday.getTime()) / 60000;
        if (minsPastClose > outletCloseBuffer) {
          closeAt = outletCloseToday;
          reason = "outlet_closed";
        }
      }
    }

    if (!closeAt || !reason) continue;

    // Don't close in the future or before clock_in
    if (closeAt > now) closeAt = now;
    if (closeAt < clockIn) closeAt = clockIn;

    const totalHours = Math.round(((closeAt.getTime() - clockIn.getTime()) / 3600000) * 100) / 100;
    flags.push(`auto_closed_${reason}`);

    await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .update({
        clock_out: closeAt.toISOString(),
        clock_out_method: "system",
        total_hours: totalHours,
        ai_flags: flags,
        ai_status: "flagged",
        final_status: null, // force manager review
      })
      .eq("id", log.id);

    closed++;
    actions.push({ logId: log.id, reason, closeAt: closeAt.toISOString() });
  }

  return NextResponse.json({
    processed: activeLogs.length,
    closed,
    actions,
    thresholds: { graceMin, staleMin, pastEndHours, outletCloseBuffer },
  });
}
