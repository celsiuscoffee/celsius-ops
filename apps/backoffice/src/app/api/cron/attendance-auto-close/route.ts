import { NextRequest, NextResponse } from "next/server";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@celsius/shared";
import { deriveHours, mytDateString, mytDayOfWeek, mytInstant } from "@/lib/hr/hours";

export const dynamic = "force-dynamic";

// Runs every 15 min via Vercel Cron.
//
// GEOFENCE IS NOT USED TO AUTO-CLOSE. The PWA has no background geofence and
// native geofence is unreliable, and closing on geofence is exactly what
// truncated real shifts to ~0h before. Clock-OUT is the source of truth; when
// it's missing we fall back to the roster, never to location pings.
//
// Auto-closes an OPEN log when:
//   1) forgot_clockout — it's past 1am (the shift is definitely over) → close at
//      the staffer's ROSTERED shift end (scheduled_end; a 10pm shift closes at
//      10pm, an 11:30 closer at 11:30). Falls back to outlet close, then the 1am
//      cutoff, only when there's no roster.
//   2) no_pings_stale — a genuinely abandoned session with no roster and open
//      longer than a full shift (backstop).
//
// PAY: a missed tap-out is NOT proven overtime, so an auto-close pays regular
// hours up to the shift end with OT = 0 (OT is only ever paid via an approved
// overtime request). Every auto-close AUTO-RESOLVES (approved + excused) — a
// forgotten tap-out isn't a staff violation, so it must not flood the review
// queue. Day-type (PH/rest-day) classification is preserved for the regular pay.
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

  const staleMin = Number(settings?.auto_close_stale_pings_minutes ?? 90);
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
    .in("date", logMytDates)
    .eq("declared", true);
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

    // Last ping — used ONLY to detect a never-pinged (abandoned) session for the
    // backstop below. Geofence pings never drive a close (see header).
    const { data: lastPing } = await hrSupabaseAdmin
      .from("hr_attendance_pings")
      .select("created_at")
      .eq("attendance_log_id", log.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastPingAt = lastPing?.created_at ? new Date(lastPing.created_at) : null;

    let closeAt: Date | null = null;
    let reason: string | null = null;

    // (1) forgot_clockout — once it's past 1am the shift is definitely over, so a
    // still-open log is a missed tap-out. Close at the ROSTERED shift end.
    {
      const shiftDate = log.scheduled_date ?? mytDateString(clockIn);
      // 1am on the morning AFTER the shift date (noon+24h dodges any edge).
      const shiftNoon = mytInstant(shiftDate, "12:00");
      const oneAmCutoff = shiftNoon
        ? mytInstant(mytDateString(new Date(shiftNoon.getTime() + 24 * 3600 * 1000)), "01:00")
        : null;
      if (oneAmCutoff && now >= oneAmCutoff) {
        // Close at the SHIFT END, never at the 1am sweep time (that's just when
        // we noticed). Prefer the stamped rostered end; else the outlet's close
        // on the SHIFT'S OWN date — NOT rolled to the next day, which lands in
        // the future and gets clamped to `now` (why closes were showing 01:01am).
        let end = schedEndInstant;
        if (!end) {
          const outlet = outletMap.get(log.outlet_id);
          if (outlet?.closeTime) end = mytInstant(shiftDate, outlet.closeTime);
        }
        // Only close when we have a real shift-end reference; never before
        // clock-in. With no roster AND no outlet close, leave it for the (2)
        // backstop rather than inventing a time.
        if (end) {
          closeAt = end < clockIn ? clockIn : end;
          reason = "forgot_clockout";
        }
      }
    }

    // (2) no_pings_stale — genuinely abandoned: never pinged AND open longer than
    // a full shift, with no roster to have caught it at (1). Backstop only.
    if (!reason && !lastPingAt && clockInAgeMin > abandonedMin) {
      closeAt = now;
      reason = "no_pings_stale";
    }

    if (!closeAt || !reason) continue;

    // Don't close in the future or before clock_in
    if (closeAt > now) closeAt = now;
    if (closeAt < clockIn) closeAt = clockIn;

    // Pay-hours split — same shared engine as a normal clock-out, so the day-type
    // (PH / rest-day) multiplier on regular hours is preserved.
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

    // NO OT on an auto-close: a missed tap-out isn't proven overtime (OT is only
    // paid via an approved overtime request). Keep regular hours (deriveHours
    // already floors them at the daily threshold) and the day-type classification,
    // but zero the OT hours. Every auto-close AUTO-RESOLVES (approved + excused)
    // so a forgotten tap-out never lands in the manager review queue.
    const update: Record<string, unknown> = {
      clock_out: closeAt.toISOString(),
      clock_out_method: "system",
      total_hours: derived.totalHours,
      regular_hours: derived.regularHours,
      overtime_hours: 0,
      overtime_type: derived.overtimeType,
      ai_flags: flags,
      ai_status: "approved",
      final_status: "approved",
      excused: true,
      excused_reason: "Auto-closed — no clock-out (paid to rostered shift end, no OT)",
      reviewed_at: now.toISOString(),
      review_notes: `System auto-close (${reason}); paid to shift end, OT excluded`,
    };

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
    thresholds: { staleMin, abandonedMin },
  });
}
