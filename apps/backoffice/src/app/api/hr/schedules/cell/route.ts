import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { getTemplate, REST_DAY_ID } from "@/lib/hr/shift-templates";

export const dynamic = "force-dynamic";

/**
 * POST: set (or clear) a shift assignment for a single (employee × day) cell.
 * Body: { outlet_id, week_start, user_id, shift_date, template_id | 'rest_day' | null }
 * template_id = null → clear the cell
 * template_id = 'rest_day' → create a rest-day marker
 * else                    → create shift from template
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { outlet_id, week_start, user_id, shift_date, template_id, custom } = body as {
    outlet_id: string;
    week_start: string;
    user_id: string;
    shift_date: string;
    template_id: string | null;
    custom?: { start_time: string; end_time: string; break_minutes?: number; label?: string };
  };

  if (!outlet_id || !week_start || !user_id || !shift_date) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Compute week_end
  const d = new Date(week_start + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  const week_end = d.toISOString().slice(0, 10);

  // Ensure schedule row exists (upsert)
  let { data: schedule } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id, status")
    .eq("outlet_id", outlet_id)
    .eq("week_start", week_start)
    .maybeSingle();

  if (!schedule) {
    const { data: newSched, error } = await hrSupabaseAdmin
      .from("hr_schedules")
      .insert({
        outlet_id,
        week_start,
        week_end,
        status: "draft",
        generated_by: "manual",
      })
      .select("id, status")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    schedule = newSched;
  }

  // Delete any existing cell for this (user, date)
  await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .delete()
    .eq("schedule_id", schedule.id)
    .eq("user_id", user_id)
    .eq("shift_date", shift_date);

  // Clear = just delete, done
  if (!template_id) {
    return NextResponse.json({ success: true, cleared: true });
  }

  // Rest day = mark with special notes (no shift times stored — we just leave cell empty with rest flag)
  if (template_id === REST_DAY_ID) {
    // We represent rest day by inserting a shift with a distinctive notes marker,
    // start=end=00:00 and role_type="Rest Day"
    const { data, error } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .insert({
        schedule_id: schedule.id,
        user_id,
        shift_date,
        start_time: "00:00",
        end_time: "00:00",
        role_type: "Rest Day",
        break_minutes: 0,
        is_ai_assigned: false,
        notes: "rest_day",
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ shift: data });
  }

  // Template-based shift
  let start_time: string;
  let end_time: string;
  let break_minutes: number;
  let role_type: string;

  if (template_id === "custom" && custom) {
    start_time = custom.start_time;
    end_time = custom.end_time;
    break_minutes = custom.break_minutes ?? 30;
    role_type = custom.label || "Custom";
  } else {
    // Try DB template first (UUID), then hardcoded template (string id)
    let dbTemplate = null;
    if (template_id.includes("-")) {
      // Looks like a UUID
      const { data } = await hrSupabaseAdmin
        .from("hr_shift_templates")
        .select("label, start_time, end_time, break_minutes")
        .eq("id", template_id)
        .maybeSingle();
      dbTemplate = data;
    }

    if (dbTemplate) {
      start_time = dbTemplate.start_time.slice(0, 5);
      end_time = dbTemplate.end_time.slice(0, 5);
      break_minutes = dbTemplate.break_minutes;
      role_type = dbTemplate.label;
    } else {
      const template = getTemplate(template_id);
      if (!template) {
        return NextResponse.json({ error: `Unknown template_id: ${template_id}` }, { status: 400 });
      }
      start_time = template.start_time;
      end_time = template.end_time;
      break_minutes = template.break_minutes;
      role_type = template.label;
    }
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .insert({
      schedule_id: schedule.id,
      user_id,
      shift_date,
      start_time,
      end_time,
      role_type,
      break_minutes,
      is_ai_assigned: false,
      notes: template_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shift: data, schedule });
}
