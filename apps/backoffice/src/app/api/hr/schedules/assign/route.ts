import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";
import { sendOpsPush } from "@/lib/ops-push";

export const dynamic = "force-dynamic";

/**
 * POST: assign a staffer to a shift via the assist panel, and log the decision.
 *
 * Body: {
 *   outlet_id, shift_date, user_id, start_time, end_time,
 *   break_minutes?, role_type?,
 *   // decision context (for the training log; optional but expected from the panel)
 *   assigned_fit_rank?, assigned_fit_score?,
 *   top_candidate_user_id?, top_candidate_fit_score?,
 *   override_reason?, candidate_snapshot?
 * }
 *
 * Creates (or replaces) the shift cell like the grid does, then writes one row
 * to hr_schedule_assist_log. `was_override` is derived here — true when the
 * assigned staffer isn't the model's #1 pick — so it can't be spoofed by the
 * client. That log is the training set for later auto-scheduling.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const body = await req.json();
  const {
    outlet_id,
    shift_date,
    user_id,
    start_time,
    end_time,
    break_minutes,
    role_type,
    assigned_fit_rank,
    assigned_fit_score,
    top_candidate_user_id,
    top_candidate_fit_score,
    override_reason,
    candidate_snapshot,
  } = body as {
    outlet_id: string;
    shift_date: string;
    user_id: string;
    start_time: string;
    end_time: string;
    break_minutes?: number;
    role_type?: string | null;
    assigned_fit_rank?: number | null;
    assigned_fit_score?: number | null;
    top_candidate_user_id?: string | null;
    top_candidate_fit_score?: number | null;
    override_reason?: string | null;
    candidate_snapshot?: unknown;
  };

  if (!outlet_id || !shift_date || !user_id || !start_time || !end_time) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shift_date) || !/^\d{2}:\d{2}/.test(start_time) || !/^\d{2}:\d{2}/.test(end_time)) {
    return NextResponse.json({ error: "Invalid date or time format" }, { status: 400 });
  }

  if (session.role === "MANAGER" && !(await canAccessOutlet(session, outlet_id))) {
    return NextResponse.json({ error: "Forbidden — managers can only edit their assigned outlets" }, { status: 403 });
  }

  // Week bounds (Monday-anchored) for the schedule row.
  const dMs = Date.parse(shift_date + "T00:00:00Z");
  const dow = new Date(dMs).getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  const week_start = new Date(dMs - daysSinceMonday * 86400000).toISOString().slice(0, 10);
  const week_end = new Date(dMs + (6 - daysSinceMonday) * 86400000).toISOString().slice(0, 10);

  // Ensure the schedule row exists (draft), mirroring the grid's cell route.
  let { data: schedule } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id, status")
    .eq("outlet_id", outlet_id)
    .eq("week_start", week_start)
    .maybeSingle();
  if (!schedule) {
    const { data: newSched, error } = await hrSupabaseAdmin
      .from("hr_schedules")
      .insert({ outlet_id, week_start, week_end, status: "draft", generated_by: "assist" })
      .select("id, status")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    schedule = newSched;
  }

  // Replace any existing cell for this (user, date), then insert the shift.
  await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .delete()
    .eq("schedule_id", schedule.id)
    .eq("user_id", user_id)
    .eq("shift_date", shift_date);

  const { data: shift, error: shiftErr } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .insert({
      schedule_id: schedule.id,
      user_id,
      shift_date,
      start_time: start_time.slice(0, 5),
      end_time: end_time.slice(0, 5),
      role_type: role_type || null,
      break_minutes: break_minutes ?? 30,
      is_ai_assigned: false,
      notes: "assist",
    })
    .select()
    .single();
  if (shiftErr) return NextResponse.json({ error: shiftErr.message }, { status: 500 });

  // Tell the staffer they're on a new shift (best-effort, same push channel as
  // the ops workspace; tap routes to My Shifts). Only when the schedule is
  // already published: a draft shift isn't visible to staff yet, so they'd get
  // the week's "Schedule published" push later instead.
  if (schedule.status === "published") {
    await sendOpsPush({
      userId: user_id,
      kind: "shift",
      title: "New shift",
      body: `You've been added to a shift on ${shift_date}.`,
    });
  }

  // Derive the override flag server-side: assigned != the model's top pick.
  const wasOverride = !!top_candidate_user_id && top_candidate_user_id !== user_id;

  // Log the decision. A failed log must not fail the assignment (best-effort),
  // but surface it so we notice a broken training pipeline.
  const { error: logErr } = await hrSupabaseAdmin.from("hr_schedule_assist_log").insert({
    manager_user_id: session.id,
    outlet_id,
    shift_date,
    slot_start: start_time.slice(0, 5),
    slot_end: end_time.slice(0, 5),
    role_type: role_type || null,
    assigned_user_id: user_id,
    assigned_fit_rank: assigned_fit_rank ?? null,
    assigned_fit_score: assigned_fit_score ?? null,
    top_candidate_user_id: top_candidate_user_id ?? null,
    top_candidate_fit_score: top_candidate_fit_score ?? null,
    was_override: wasOverride,
    override_reason: wasOverride ? override_reason || null : null,
    candidate_snapshot: candidate_snapshot ?? null,
  });

  return NextResponse.json({ shift, schedule, was_override: wasOverride, log_ok: !logErr });
}
