import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { canAccessOutlet, hasModuleAccess } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// POST: clear all shifts for an outlet × week (keeps the schedule row as draft)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await hasModuleAccess(session, "hr:schedules"))) {
    return NextResponse.json({ error: "Forbidden — no access to Schedules" }, { status: 403 });
  }

  const body = await req.json();
  const { outlet_id, week_start } = body as { outlet_id: string; week_start: string };

  if (!outlet_id || !week_start) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // MANAGER can only clear schedules for outlets they're assigned to
  if (session.role === "MANAGER") {
    const allowed = await canAccessOutlet(session, outlet_id);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — managers can only clear their assigned outlets" }, { status: 403 });
    }
  }

  const { data: schedule } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id, status")
    .eq("outlet_id", outlet_id)
    .eq("week_start", week_start)
    .maybeSingle();

  if (!schedule) return NextResponse.json({ success: true, deleted: 0 });

  if (schedule.status === "published") {
    return NextResponse.json(
      { error: "Cannot clear a published schedule. Unpublish first." },
      { status: 400 },
    );
  }

  const { error, count } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .delete({ count: "exact" })
    .eq("schedule_id", schedule.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, deleted: count ?? 0 });
}
