import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { SHIFT_TEMPLATES as FALLBACK_TEMPLATES, templatesForOutlet } from "@/lib/hr/shift-templates";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// GET: full scheduling grid (employees × days) for one outlet for one week
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Module access gate: Schedules is optional per manager (e.g. Syafiq/Chef Bo
  // don't have hr:schedules, so they can't call the grid API even via direct URL).
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const outletId = searchParams.get("outlet_id");
  const weekStart = searchParams.get("week_start"); // YYYY-MM-DD (Monday)

  if (!outletId || !weekStart) {
    return NextResponse.json({ error: "outlet_id and week_start required" }, { status: 400 });
  }

  // MANAGER can only request the grid for outlets they're assigned to
  if (session.role === "MANAGER") {
    const allowed = await canAccessOutlet(session, outletId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — managers can only view their assigned outlets" }, { status: 403 });
    }
  }

  // Compute week end (Sunday)
  const start = new Date(weekStart + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);

  // 1. Outlet info
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, code: true, name: true, openTime: true, closeTime: true, daysOpen: true },
  });
  if (!outlet) return NextResponse.json({ error: "Outlet not found" }, { status: 404 });

  // 2. Staff at this outlet. OWNER is included so working owners can be
  //    scheduled; OWNERs who shouldn't appear just keep schedule_required=false
  //    on their hr_employee_profile (filtered below).
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ outletId }, { outletIds: { has: outletId } }],
      role: { in: ["STAFF", "MANAGER", "OWNER"] },
    },
    select: { id: true, name: true, fullName: true, role: true },
    orderBy: { name: "asc" },
  });

  // 3. HR profiles (position, employment type, schedule flag)
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, position, employment_type, schedule_required")
    .in("user_id", users.map((u) => u.id));

  type ProfileRow = { user_id: string; position: string; employment_type: string; schedule_required: boolean };
  const profileMap = new Map<string, ProfileRow>(
    (profiles || []).map((p: ProfileRow) => [p.user_id, p]),
  );

  // Filter out users marked schedule_required=false (Director, HQ roles, etc.)
  // If no profile exists, include by default (schedule_required defaults to true)
  const scheduledUsers = users.filter((u) => {
    const p = profileMap.get(u.id);
    return !p || p.schedule_required !== false;
  });

  // 4. Existing schedule for this week
  const { data: schedule } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("*")
    .eq("outlet_id", outletId)
    .eq("week_start", weekStart)
    .maybeSingle();

  // 5. Shifts (if schedule exists)
  let shifts: Array<{ id: string; user_id: string; shift_date: string; start_time: string; end_time: string; role_type: string | null; break_minutes: number; notes: string | null }> = [];
  if (schedule) {
    const { data } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("id, user_id, shift_date, start_time, end_time, role_type, break_minutes, notes")
      .eq("schedule_id", schedule.id);
    shifts = data || [];
  }

  // 6. Approved leave during this week (to show "On Leave" cells)
  const { data: leaves } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("user_id, leave_type, start_date, end_date")
    .in("status", ["approved", "ai_approved"])
    .in("user_id", scheduledUsers.map((u) => u.id))
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart);

  // 7. Staff availability (blockout dates)
  const { data: availability } = await hrSupabaseAdmin
    .from("hr_staff_availability")
    .select("user_id, date, availability, reason")
    .in("user_id", scheduledUsers.map((u) => u.id))
    .gte("date", weekStart)
    .lte("date", weekEnd);

  // 8. Public holidays in this week
  const { data: holidays } = await hrSupabaseAdmin
    .from("hr_public_holidays")
    .select("date, name")
    .gte("date", weekStart)
    .lte("date", weekEnd);

  // 9. Weekly recurring availability — PART-TIMERS ONLY.
  // Full-timers work fixed schedules, so availability doesn't apply to them.
  const partTimerIds = scheduledUsers
    .filter((u) => profileMap.get(u.id)?.employment_type === "part_time")
    .map((u) => u.id);
  const { data: weeklyAvailability } = partTimerIds.length > 0
    ? await hrSupabaseAdmin
        .from("hr_staff_weekly_availability")
        .select("user_id, day_of_week, available_from, available_until, is_preferred, max_shifts_per_week")
        .in("user_id", partTimerIds)
    : { data: [] as unknown[] };

  // 10. Outlet coverage rules for this outlet
  const { data: coverageRules } = await hrSupabaseAdmin
    .from("hr_outlet_coverage_rules")
    .select("day_of_week, slot_start, slot_end, min_staff, slot_label, is_peak")
    .eq("outlet_id", outletId);

  // Build 7-day array
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  // Load shift templates from DB (outlet-specific + generic)
  const { data: outletTemplates } = await hrSupabaseAdmin
    .from("hr_shift_templates")
    .select("*")
    .eq("is_active", true)
    .or(`outlet_id.eq.${outletId},outlet_id.is.null`)
    .order("sort_order");

  const { data: allDbTemplates } = await hrSupabaseAdmin
    .from("hr_shift_templates")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");

  type DbTemplate = { id: string; label: string; start_time: string; end_time: string; break_minutes: number; color: string; outlet_id: string | null };
  const formatTemplate = (t: DbTemplate) => ({
    id: t.id,
    label: t.label,
    start_time: t.start_time.slice(0, 5),
    end_time: t.end_time.slice(0, 5),
    break_minutes: t.break_minutes,
    color: t.color || "gray",
  });
  const dbTemplates = (outletTemplates || []).map(formatTemplate);
  const dbAllTemplates = (allDbTemplates || []).map(formatTemplate);

  return NextResponse.json({
    outlet,
    week_start: weekStart,
    week_end: weekEnd,
    days,
    users: scheduledUsers.map((u) => ({
      ...u,
      profile: profileMap.get(u.id) || null,
    })),
    schedule, // null if not yet created
    shifts,
    leaves: leaves || [],
    availability: availability || [],        // per-date exceptions (existing)
    weeklyAvailability: weeklyAvailability || [],  // part-timer recurring (new)
    coverageRules: coverageRules || [],
    holidays: holidays || [],
    templates: dbTemplates.length > 0 ? dbTemplates : templatesForOutlet(outlet.code),
    all_templates: dbAllTemplates.length > 0 ? dbAllTemplates : FALLBACK_TEMPLATES,
  });
}
