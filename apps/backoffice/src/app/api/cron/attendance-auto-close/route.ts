import { NextRequest, NextResponse } from "next/server";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@celsius/shared";
import { touchAgentRun, logAgentAction } from "@celsius/agents/src/substrate";
import { deriveHours, mytDateString, mytInstant } from "@/lib/hr/hours";
import { REST_DAY_ROLE_PATTERN } from "@/lib/hr/constants";
import { processAttendance } from "@/lib/hr/agents/attendance-processor";

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
  await touchAgentRun("hr_attendance_auto_close");

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
    .select("user_id, employment_type")
    .in("user_id", userIds);
  const employmentByUser = new Map<string, string>();
  (profiles || []).forEach((p: { user_id: string; employment_type: string | null }) => {
    employmentByUser.set(p.user_id, p.employment_type || "full_time");
  });
  const logMytDates = Array.from(new Set(activeLogs.map((l: { clock_in: string }) => mytDateString(l.clock_in))));
  const { data: holidays } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date")
    .in("date", logMytDates);
  const publicHolidaySet = new Set((holidays || []).map((h: { date: string }) => h.date));

  // Rest day is ROSTERED, not a weekday on the profile — the roster carries a
  // "Rest Day" row per person per week and it rotates. Same source as the AI
  // processor so an auto-closed log pays the identical multiplier.
  const { data: restRows } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("user_id, shift_date")
    .ilike("role_type", REST_DAY_ROLE_PATTERN)
    .in("user_id", userIds)
    .in("shift_date", logMytDates);
  const rosteredRestDays = new Set(
    (restRows || []).map((r: { user_id: string; shift_date: string }) => `${r.user_id}|${r.shift_date}`),
  );

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
        // Only close when we have a real shift-end reference. An end at or
        // BEFORE clock-in is a bad reference, not a zero-hour shift — clamping
        // it to clock-in wrote a 0.00h log that was auto-approved AND excused,
        // so the staffer was paid nothing and nothing surfaced for review.
        // Three ways it happens, all seen in production:
        //   - stale scheduled_date: yesterday's roster stamped on today's log,
        //     putting the end ~24h in the past (the common case)
        //   - a rest-day roster row, which stores 00:00-00:00, so the end is
        //     midnight at the START of the shift date
        //   - a clock-in a few minutes AFTER the rostered end (late arrival
        //     onto the next shift)
        // Refuse to close on a reference we don't trust; leave it open for the
        // (2) backstop or a human.
        if (end && end > clockIn) {
          closeAt = end;
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

    // Don't close in the future.
    if (closeAt > now) closeAt = now;
    // Never fabricate a zero-length shift. Previously this clamped to clock-in,
    // which is what turned a bad close reference into a paid-nothing log.
    if (closeAt <= clockIn) continue;

    // Pay-hours split — same shared engine as a normal clock-out, so the day-type
    // (PH / rest-day) multiplier on regular hours is preserved.
    const employmentType = employmentByUser.get(log.user_id) || "full_time";
    const clockInDate = mytDateString(clockIn);
    const derived = deriveHours({
      clockIn,
      clockOut: closeAt,
      employmentType,
      isPublicHoliday: publicHolidaySet.has(clockInDate),
      isRestDay: rosteredRestDays.has(`${log.user_id}|${clockInDate}`),
      // The paid window: only time inside the rostered shift counts. An
      // auto-close already caps the clock-out at the roster/outlet close, so the
      // end bound mostly just makes the two paths agree.
      scheduledStart: mytInstant(log.scheduled_date ?? mytDateString(clockIn), log.scheduled_start),
      scheduledEnd: mytInstant(log.scheduled_date ?? mytDateString(clockIn), log.scheduled_end),
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

  if (closed > 0) {
    await logAgentAction({
      agentKey: "hr_attendance_auto_close",
      kind: "attendance_closed",
      summary: `Auto-closed ${closed} open attendance log${closed === 1 ? "" : "s"} at rostered shift end (paid regular hours, OT=0)`,
      meta: { processed: activeLogs.length, closed },
    });
  }

  // Evaluate everything still sitting at ai_status='pending' — geofence, late
  // arrival, OT detection, auto-approve or flag.
  //
  // This runs HERE rather than on its own Vercel Cron entry because the project
  // is at the 38-cron budget (`src/vercel-crons.test.ts`; Vercel silently drops
  // entries past 40). Auto-close is the right host: same table, same domain, and
  // it must run FIRST so a forgotten tap-out is closed before the processor
  // judges it as "missing clock-out".
  //
  // Without this the processor only ever ran from a manual POST to
  // /api/hr/attendance/process, so logs stayed 'pending' indefinitely — and the
  // payroll calculator pays OT only on APPROVED logs (see isOtApproved in
  // agents/payroll-calculator.ts). July 2026: 527 pending logs carried 265 of the
  // month's 391 OT hours, none of it payable.
  let processorResult: Awaited<ReturnType<typeof processAttendance>> | null = null;
  try {
    processorResult = await processAttendance();
    if (processorResult.processed > 0) {
      await logAgentAction({
        agentKey: "hr_attendance_auto_close",
        kind: "attendance_processed",
        summary:
          `Processed ${processorResult.processed} pending log${processorResult.processed === 1 ? "" : "s"} ` +
          `(${processorResult.autoApproved} auto-approved, ${processorResult.flagged} flagged for review)`,
        meta: processorResult,
      });
    }
  } catch (err) {
    // Never let a processor failure mask the auto-close result — the close
    // writes above already landed.
    processorResult = {
      processed: 0,
      autoApproved: 0,
      flagged: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  // Errors used to be visible ONLY when processed > 0 and the route returned
  // 200 regardless — a permanently failing processor (schema drift on its
  // select, a thrown fetch) left logs 'pending' forever with a green heartbeat,
  // the exact failure mode that once sat on 527 pending logs carrying 265
  // unpaid OT hours. Failures now land in the agent action log every run they
  // occur, whether or not anything processed.
  if (processorResult.errors.length > 0) {
    await logAgentAction({
      agentKey: "hr_attendance_auto_close",
      kind: "attendance_processor_errors",
      summary:
        `Attendance processor hit ${processorResult.errors.length} error${processorResult.errors.length === 1 ? "" : "s"} ` +
        `(${processorResult.processed} processed) — pending logs may be stuck`,
      meta: processorResult,
    });
  }

  return NextResponse.json({
    processed: activeLogs.length,
    closed,
    actions,
    thresholds: { staleMin, abandonedMin },
    attendanceProcessor: processorResult,
  });
}
