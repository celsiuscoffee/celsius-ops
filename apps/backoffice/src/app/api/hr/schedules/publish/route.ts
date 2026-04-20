import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { linkChecklistsToSchedule } from "@/lib/hr/agents/checklist-linker";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// POST: publish or unpublish a weekly schedule.
// Body: { outlet_id, week_start, action: 'publish' | 'unpublish' }
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const body = await req.json();
  const { outlet_id, week_start, action } = body as { outlet_id: string; week_start: string; action: string };

  // MANAGER can only publish/unpublish schedules for outlets they're assigned to
  if (session.role === "MANAGER") {
    const allowed = await canAccessOutlet(session, outlet_id);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — managers can only publish their assigned outlets" }, { status: 403 });
    }
  }

  const { data: schedule } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id, status")
    .eq("outlet_id", outlet_id)
    .eq("week_start", week_start)
    .maybeSingle();

  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  if (action === "publish") {
    const { error } = await hrSupabaseAdmin
      .from("hr_schedules")
      .update({
        status: "published",
        published_by: session.id,
        published_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-link SOPs/checklists to shifts
    let checklistResult = null;
    try {
      checklistResult = await linkChecklistsToSchedule(schedule.id);
    } catch (err) {
      console.error("Checklist linking failed:", err);
    }

    return NextResponse.json({ success: true, checklists: checklistResult });
  }

  if (action === "unpublish") {
    const { error } = await hrSupabaseAdmin
      .from("hr_schedules")
      .update({ status: "draft", published_at: null })
      .eq("id", schedule.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
