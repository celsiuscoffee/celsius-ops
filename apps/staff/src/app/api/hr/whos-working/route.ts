import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: these hr_* tables are RLS-enabled with no policies, so
// the anon client reads zero rows (screen shows empty). Access stays scoped by
// the getSession gate + the outlet filter below.
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/hr/whos-working?date=YYYY-MM-DD (defaults to today, MYT)
// Everyone rostered at the caller's outlet on that day, so a barista can see
// who else is on shift with them. Scoped to the caller's own outlet; published
// schedules only. Mirrors the service-role + outlet-scope pattern of
// /api/hr/whos-away and the shift join used by /api/hr/shifts.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Default to today in MYT (UTC+8) so "today" flips at local midnight, not UTC.
  const mytToday = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const date = req.nextUrl.searchParams.get("date") || mytToday;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  // A staff member only ever sees their own outlet's roster. Managers/owners
  // default to their assigned outlet too (this screen answers "who is on with
  // me"). No outlet on the account means there is nothing to show.
  const outletId = session.outletId;
  if (!outletId) return NextResponse.json({ date, team: [] });

  const { data: shifts, error } = await supabase
    .from("hr_schedule_shifts")
    .select(
      "user_id, start_time, end_time, role_type, hr_schedules!inner(status, outlet_id)",
    )
    .eq("hr_schedules.outlet_id", outletId)
    .eq("hr_schedules.status", "published")
    .eq("shift_date", date)
    // "00:00" start rows are unscheduled placeholders, not real shifts.
    .neq("start_time", "00:00");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (shifts || []) as Array<{
    user_id: string;
    start_time: string;
    end_time: string;
    role_type: string | null;
  }>;
  if (rows.length === 0) return NextResponse.json({ date, team: [] });

  // Names live on the Prisma User (the hr_* tables key by user_id only).
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, fullName: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.fullName || u.name]));

  const team = rows
    .filter((r) => nameById.has(r.user_id))
    .map((r) => ({
      user_id: r.user_id,
      name: nameById.get(r.user_id) ?? "Teammate",
      position: r.role_type ?? null,
      start_time: r.start_time,
      end_time: r.end_time,
      is_me: r.user_id === session.id,
    }))
    .sort(
      (a, b) =>
        a.start_time.localeCompare(b.start_time) || a.name.localeCompare(b.name),
    );

  return NextResponse.json({ date, team });
}
