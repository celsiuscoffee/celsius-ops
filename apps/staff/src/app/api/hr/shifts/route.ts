import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: these hr_* tables are RLS-enabled with no policies, so the
// anon client reads zero rows (screen shows empty). Access stays scoped by the
// getSession gate + the per-user filters below.
import { supabaseAdmin as supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my upcoming shifts
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);

  // Get published schedule shifts for this user from today onwards
  const { data: shifts, error } = await supabase
    .from("hr_schedule_shifts")
    .select("*, hr_schedules!inner(status, outlet_id, week_start)")
    .eq("user_id", session.id)
    .eq("hr_schedules.status", "published")
    .gte("shift_date", today)
    .order("shift_date", { ascending: true })
    .limit(14);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The native Shift type (apps/staff-native/lib/hr/api.ts) reads
  // `shift.position`, but the row stores it as `role_type` (no `position`
  // column). Alias it additively, same mapping the backoffice grid uses.
  const rows = (shifts || []) as Array<Record<string, unknown>>;
  const mapped = rows.map((row) => ({ ...row, position: row.role_type ?? null }));

  return NextResponse.json({ shifts: mapped });
}
