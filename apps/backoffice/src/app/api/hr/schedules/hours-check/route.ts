import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { hasModuleAccess, resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// POST /api/hr/schedules/hours-check
// Body: { user_id, week_start (YYYY-MM-DD Monday), additional_hours? (proposed new shift), exclude_shift_id? }
// Returns: { current_hours, proposed_total, limit, warn_threshold, hard_cap, status: 'ok' | 'warn' | 'overtime' | 'block' }
//
// SCOPE: sums hours across ALL outlets the user works at for that week (user-scoped, not outlet-scoped),
// so staff who rotate between outlets have their combined weekly hours checked against the Employment Act cap.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Same module-access gate as the rest of the schedule endpoints.
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const body = await req.json();
  const { user_id, week_start, additional_hours = 0, exclude_shift_id } = body as {
    user_id?: string; week_start?: string; additional_hours?: number; exclude_shift_id?: string;
  };

  if (!user_id || !week_start) {
    return NextResponse.json({ error: "user_id and week_start required" }, { status: 400 });
  }

  // MANAGER can only hours-check their own subtree (prevents lateral probing
  // of other managers' reports' schedules).
  if (session.role === "MANAGER") {
    const visibleIds = await resolveVisibleUserIds(session);
    const allowed = new Set([session.id, ...(visibleIds || [])]);
    if (!allowed.has(user_id)) {
      return NextResponse.json({ error: "Forbidden — outside your subtree" }, { status: 403 });
    }
  }

  // Load company rules
  const { data: settings } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("max_regular_hours_per_week, overtime_warn_threshold, hard_cap_hours_per_week, overtime_requires_approval")
    .limit(1)
    .maybeSingle();

  const limit = Number(settings?.max_regular_hours_per_week ?? 45);
  const warn = Number(settings?.overtime_warn_threshold ?? 40);
  const hardCap = Number(settings?.hard_cap_hours_per_week ?? 60);
  const otRequiresApproval = settings?.overtime_requires_approval !== false;

  // Compute week_end (Mon + 6 days). Use UTC so the calc is timezone-stable
  // across Vercel regions and DST edges.
  const start = new Date(week_start + "T00:00:00Z");
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);

  // Sum hours from all shifts this user has that week — across ALL outlets
  let query = hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("id, start_time, end_time, break_minutes, shift_date")
    .eq("user_id", user_id)
    .gte("shift_date", week_start)
    .lte("shift_date", weekEnd);
  if (exclude_shift_id) query = query.neq("id", exclude_shift_id);

  const { data: shifts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  let currentMinutes = 0;
  for (const s of shifts || []) {
    const dur = toMin(s.end_time) - toMin(s.start_time) - (s.break_minutes || 0);
    if (dur > 0) currentMinutes += dur;
  }
  const currentHours = currentMinutes / 60;
  const proposedTotal = currentHours + Number(additional_hours || 0);

  // Check for approved OT for this week
  const { data: otApprovals } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("hours_approved, status, date, request_type")
    .eq("user_id", user_id)
    .gte("date", week_start)
    .lte("date", weekEnd)
    .in("status", ["approved", "partial"]);

  const approvedOtHours = (otApprovals || []).reduce(
    (sum: number, r: { hours_approved?: number }) => sum + Number(r.hours_approved || 0),
    0
  );
  const effectiveLimit = limit + approvedOtHours; // pre-approved OT raises the cap

  let status: "ok" | "warn" | "overtime" | "block";
  let message: string;
  if (proposedTotal > hardCap) {
    status = "block";
    message = `Blocks at ${hardCap}h/week hard cap. Current ${currentHours.toFixed(1)}h + proposed ${additional_hours}h = ${proposedTotal.toFixed(1)}h.`;
  } else if (proposedTotal > effectiveLimit) {
    status = "overtime";
    message = approvedOtHours > 0
      ? `Exceeds approved OT (${limit}h regular + ${approvedOtHours}h approved = ${effectiveLimit}h). Additional OT approval needed.`
      : `This shift pushes weekly hours to ${proposedTotal.toFixed(1)}h — above the ${limit}h regular cap. ${otRequiresApproval ? "Requires overtime approval." : "Will be paid as overtime."}`;
  } else if (proposedTotal > warn) {
    status = "warn";
    message = `Approaching the ${limit}h weekly limit (now ${proposedTotal.toFixed(1)}h).`;
  } else {
    status = "ok";
    message = `${proposedTotal.toFixed(1)}h / ${limit}h weekly cap.`;
  }

  return NextResponse.json({
    current_hours: Number(currentHours.toFixed(2)),
    proposed_total: Number(proposedTotal.toFixed(2)),
    limit,
    effective_limit: effectiveLimit,
    approved_ot_hours: approvedOtHours,
    warn_threshold: warn,
    hard_cap: hardCap,
    overtime_requires_approval: otRequiresApproval,
    status,
    message,
    shift_count: (shifts || []).length,
  });
}
