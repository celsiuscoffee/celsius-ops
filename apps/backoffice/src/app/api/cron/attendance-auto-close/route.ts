import { NextRequest, NextResponse } from "next/server";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@celsius/shared";
import { deriveHours, mytDateString, mytDayOfWeek, mytInstant } from "@/lib/hr/hours";

export const dynamic = "force-dynamic";

// Runs every 15 min via Vercel Cron.
// Auto-closes attendance logs that match any of:
//   A) Last in-zone ping was > geofence_exit_grace_minutes ago
//   B) No ping at all + open past an ABANDONED threshold (staff never came back)
//   C) Scheduled shift end + auto_close_after_scheduled_end_hours passed
//   D) Outlet closed + auto_close_at_outlet_close_minutes passed
//
// Clock-out time is set to:
//   - For (A) → last in-zone ping, but floored at the rostered scheduled end
//     (the PWA can't background-ping, so the last in-zone ping often lands
//     seconds after clock-in and would truncate a full shift to ~0h)
//   - For (B), (C), (D) → scheduled end or now (whichever earlier)
//
// The close writes the SAME regular/OT hour split a normal clock-out would (via
// the shared deriveHours engine) — otherwise payroll reads regular_hours = 0 for
// every auto-closed log and shorts the shift. ai_flags always gets
// "auto_closed_<reason>" for the audit trail. The two PING-BASED reasons
// (A geofence_exit, B no_pings_stale) are unreliable on the PWA, so they
// AUTO-RESOLVE (approved + excused, penalty waived) rather than flooding the
// manager review queue. The deterministic reasons (C, D) still surface as flagged.
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
  // Rule B is a BACKSTOP for an abandoned session, not a mid-shift closer. Never
  // fire before a plausible max shift (16h) even if pings are stale — a barista
  // who clocked in and backgrounded the PWA is still working.
  const abandonedMin = Math.max(16 * 60, staleMin);

  // Active attendance logs
  const { data: activeLogs } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id, user_id, outlet_id, clock_in, scheduled_start, scheduled_end, scheduled_date, ai_flags")
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

  // Employment type + rest day (for the pay-hours split) and public holidays for
  // the MYT dates in play (for the OT multiplier) — same inputs the AI processor
  // uses, so an auto-closed log pays identically to a normal clock-out.
  const userIds = Array.from(new Set(activeLogs.map((l: { user_id: string }) => l.user_id)));
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, employment_type, rest_day")
    .in("user_id", userIds);
  const employmentByUser = new Map<string, string>();
  const restDayByUser = new Map<string, number>();
  (profiles || []).forEach((p: { user_id: string; employment_type: string | null; rest_day: number | null }) => {
    employmentByUser.set(p.user_id, p.employment_type || "full_time");
    restDayByUser.set(p.user_id, p.rest_day == null ? 0 : Number(p.rest_day));
  });
  const logMytDates = Array.from(new Set(activeLogs.map((l: { clock_in: string }) => mytDateString(l.clock_in))));
  const { data: holidays } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date")
    .in("date", logMytDates);
  const publicHolidaySet = new Set((holidays || []).map((h: { date: string }) => h.date));

  let closed = 0;
  const actions: { logId: string; reason: string; closeAt: string }[] = [];

  for (const log of activeLogs) {
    const clockIn = new Date(log.clock_in);
    const clockInAgeMin = (now.getTime() - clockIn.getTime()) / 60000;
    const flags: string[] = Array.isArray(log.ai_flags) ? [...log.ai_flags] : [];

    // Rostered shift-end instant (scheduled_end is a MYT wall time; pair it with
    // the roster date). Used by Rule C and the ping-rule anti-truncation floor.
    const schedEndInstant = mytInstant(log.scheduled_date ?? mytDateString(log.clock_in), log.scheduled_end);

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

    // Rule C: Past scheduled end + pastEndHours (deterministic, roster-driven).
    if (!reason && schedEndInstant) {
      const hoursPastEnd = (now.getTime() - schedEndInstant.getTime()) / 3600000;
      if (hoursPastEnd > pastEndHours) {
        closeAt = schedEndInstant;
        reason = "past_scheduled_end";
      }
    }

    // Rule D: Outlet closed + buffer. Build the close instant in MYT (closeTime is
    // a local "HH:MM" — setHours on a UTC server would treat 22:00 as 22:00 UTC =
    // 06:00 MYT next day and close ~8h late at the wrong time).
    if (!reason) {
      const outlet = outletMap.get(log.outlet_id);
      if (outlet?.closeTime) {
        let outletClose = mytInstant(mytDateString(clockIn), outlet.closeTime);
        // After-midnight / late shift: if close is before clock-in, it's the next MYT day.
        if (outletClose && outletClose < clockIn) {
          const nextDay = mytDateString(new Date(clockIn.getTime() + 24 * 3600 * 1000));
          outletClose = mytInstant(nextDay, outlet.closeTime);
        }
        if (outletClose) {
          const minsPastClose = (now.getTime() - outletClose.getTime()) / 60000;
          if (minsPastClose > outletCloseBuffer) {
            closeAt = outletClose;
            reason = "outlet_closed";
          }
        }
      }
    }

    // Rule B: No pings at all + open past the ABANDONED threshold (backstop only).
    if (!reason && !lastPingAt && clockInAgeMin > abandonedMin) {
      closeAt = now;
      reason = "no_pings_stale";
    }

    if (!closeAt || !reason) continue;

    // Ping-based rules misfire on the PWA (can't background-ping): the last
    // in-zone ping can land seconds after clock-in, truncating a real shift to
    // ~0h. For these, prefer the rostered scheduled end so hours aren't
    // under-counted (and payroll isn't shorted).
    const isPingRule = reason === "geofence_exit" || reason === "no_pings_stale";
    if (isPingRule && schedEndInstant && schedEndInstant > closeAt && schedEndInstant <= now) {
      closeAt = schedEndInstant;
    }

    // Don't close in the future or before clock_in
    if (closeAt > now) closeAt = now;
    if (closeAt < clockIn) closeAt = clockIn;

    // Pay-hours split — identical to a normal clock-out (F1). Day type keyed on
    // the MYT calendar day so a pre-08:00 opening shift gets the right multiplier.
    const employmentType = employmentByUser.get(log.user_id) || "full_time";
    const restDay = restDayByUser.get(log.user_id) ?? 0;
    const derived = deriveHours({
      clockIn,
      clockOut: closeAt,
      employmentType,
      isPublicHoliday: publicHolidaySet.has(mytDateString(clockIn)),
      isRestDay: mytDayOfWeek(clockIn) === restDay,
    });

    flags.push(`auto_closed_${reason}`, ...derived.dayTypeFlags);

    // A system auto-close is not a staff violation. Ping-based closes are
    // false positives on the PWA → auto-resolve (penalty waived) and keep the
    // audit flag for the "All" tab, instead of flooding the review queue.
    // Deterministic closes (past scheduled end / outlet closed) still flag.
    const update: Record<string, unknown> = {
      clock_out: closeAt.toISOString(),
      clock_out_method: "system",
      total_hours: derived.totalHours,
      regular_hours: derived.regularHours,
      overtime_hours: derived.overtimeHours,
      overtime_type: derived.overtimeType,
      ai_flags: flags,
      ai_status: isPingRule ? "approved" : "flagged",
      final_status: isPingRule ? "approved" : null,
    };
    if (isPingRule) {
      update.excused = true;
      update.excused_reason = "Auto-resolved — app ping limitation";
      update.reviewed_at = now.toISOString();
      update.review_notes = "System auto-close (PWA ping limitation); penalty waived";
    }

    // Guard against a live clock-out landing in the same instant: only close if
    // still open, so the cron never overwrites a real clock-out (wrong method/hours).
    const { data: updated } = await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .update(update)
      .eq("id", log.id)
      .is("clock_out", null)
      .select("id");

    if (!updated || updated.length === 0) continue; // a real clock-out beat us to it

    closed++;
    actions.push({ logId: log.id, reason, closeAt: closeAt.toISOString() });
  }

  return NextResponse.json({
    processed: activeLogs.length,
    closed,
    actions,
    thresholds: { graceMin, staleMin, pastEndHours, outletCloseBuffer, abandonedMin },
  });
}
