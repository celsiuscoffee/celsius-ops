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

  // Get published schedule shifts for this user from today onwards.
  // AI pt_suggestion rows are excluded: they are UNCONFIRMED proposals a
  // manager hasn't accepted — payroll and the no-show check both skip them,
  // but My Shifts was presenting them to the staffer as real shifts (even on
  // dates they had blocked). NULL-safe filter: a bare .neq drops NULL notes.
  const { data: shifts, error } = await supabase
    .from("hr_schedule_shifts")
    .select("*, hr_schedules!inner(status, outlet_id, week_start)")
    .eq("user_id", session.id)
    .eq("hr_schedules.status", "published")
    .gte("shift_date", today)
    .or("notes.is.null,notes.neq.pt_suggestion")
    .order("shift_date", { ascending: true })
    .limit(14);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The native Shift type (apps/staff-native/lib/hr/api.ts) reads
  // `shift.position`, but the row stores it as `role_type` (no `position`
  // column). Alias it additively, same mapping the backoffice grid uses.
  const rows = (shifts || []) as Array<Record<string, unknown>>;

  // Resolve the outlet NAME. The schedule carries only outlet_id, so a staffer
  // who rotates between outlets saw a week of shifts with no way to tell where
  // any of them were.
  //
  // Names live in the Prisma-cased "Outlet" table — NOT `outlets`, which does
  // not carry these ids and silently joins to null.
  const outletIds = [
    ...new Set(
      rows
        .map((row) => (row.hr_schedules as { outlet_id?: string } | null)?.outlet_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: outlets } = outletIds.length
    ? await supabase.from("Outlet").select("id, name").in("id", outletIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const outletNameById = new Map((outlets || []).map((o) => [o.id, o.name]));

  const mapped = rows.map((row) => {
    const outletId = (row.hr_schedules as { outlet_id?: string } | null)?.outlet_id;
    return {
      ...row,
      position: row.role_type ?? null,
      outlet_name: outletId ? outletNameById.get(outletId) ?? null : null,
    };
  });

  return NextResponse.json({ shifts: mapped });
}
