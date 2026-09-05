import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
// Service-role client: hr_* tables are RLS-enabled with no policies. Access is
// scoped by the session gate + the "my shift" ownership check below.
import { supabaseAdmin as supabase } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import { getMYTToday } from "@/lib/hr/constants";
import { isRestRow, SWAPPABLE_SELECT, type SwappableShiftRow, flattenSwappable } from "@/lib/hr/swap-shared";

export const dynamic = "force-dynamic";

// How far either side of my shift a coworker's shift may sit to be offered.
const WINDOW_DAYS = 14;

function shiftDate(base: string, days: number): string {
  return new Date(new Date(`${base}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

// GET /api/hr/swap/candidates?shift_id=<one of my shifts>
// Coworkers' shifts I could swap the given shift with: same outlet, published,
// still ahead of today, within ±14 days, not a rest row, not already tied up
// in another pending swap. This is what the "Swap" picker on My Shifts lists —
// until now the request action existed but nothing in the app could call it.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shiftId = req.nextUrl.searchParams.get("shift_id");
  if (!shiftId) return NextResponse.json({ error: "shift_id required" }, { status: 400 });

  const { data: mineRaw } = await supabase
    .from("hr_schedule_shifts")
    .select(SWAPPABLE_SELECT)
    .eq("id", shiftId)
    .eq("user_id", session.id)
    .maybeSingle();
  if (!mineRaw) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  const mine = flattenSwappable(mineRaw as unknown as SwappableShiftRow);

  const today = getMYTToday();
  if (mine.status !== "published") {
    return NextResponse.json({ error: "This shift isn't on a published roster yet", reason: "unpublished" }, { status: 409 });
  }
  if (mine.shift_date <= today) {
    return NextResponse.json({ error: "Swaps need to be requested before the day of the shift", reason: "too_late" }, { status: 409 });
  }
  if (isRestRow(mine)) {
    return NextResponse.json({ error: "A rest day can't be swapped", reason: "rest_day" }, { status: 409 });
  }
  if (!mine.outlet_id) {
    return NextResponse.json({ myShift: mine, candidates: [] });
  }

  const from = shiftDate(mine.shift_date, -WINDOW_DAYS) > today ? shiftDate(mine.shift_date, -WINDOW_DAYS) : shiftDate(today, 1);
  const to = shiftDate(mine.shift_date, WINDOW_DAYS);

  const { data: rows, error } = await supabase
    .from("hr_schedule_shifts")
    .select(SWAPPABLE_SELECT)
    .eq("hr_schedules.outlet_id", mine.outlet_id)
    .eq("hr_schedules.status", "published")
    .neq("user_id", session.id)
    .gte("shift_date", from)
    .lte("shift_date", to)
    // AI pt_suggestion rows are unconfirmed proposals, not real shifts.
    .or("notes.is.null,notes.neq.pt_suggestion")
    .order("shift_date", { ascending: true })
    .order("start_time", { ascending: true })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const shifts = ((rows || []) as unknown as SwappableShiftRow[]).map(flattenSwappable).filter((s) => !isRestRow(s));
  if (shifts.length === 0) return NextResponse.json({ myShift: mine, candidates: [] });

  // Drop shifts already sitting in a pending swap (theirs or mine).
  const ids = [mine.id, ...shifts.map((s) => s.id)];
  const { data: open } = await supabase
    .from("hr_shift_swap_requests")
    .select("requester_shift_id, target_shift_id")
    .in("status", ["pending_consent", "pending_approval"])
    .or(`requester_shift_id.in.(${ids.join(",")}),target_shift_id.in.(${ids.join(",")})`);
  const busy = new Set((open || []).flatMap((o) => [o.requester_shift_id as string, o.target_shift_id as string]));
  const myShiftBusy = busy.has(mine.id);

  const userIds = Array.from(new Set(shifts.map((s) => s.user_id)));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, status: "ACTIVE" },
    select: { id: true, name: true, fullName: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.fullName || u.name]));

  const candidates = shifts
    .filter((s) => !busy.has(s.id) && nameById.has(s.user_id))
    .map((s) => ({
      shift_id: s.id,
      user_id: s.user_id,
      name: nameById.get(s.user_id) ?? "Coworker",
      shift_date: s.shift_date,
      start_time: s.start_time,
      end_time: s.end_time,
      role_type: s.role_type,
    }));

  return NextResponse.json({ myShift: mine, myShiftBusy, candidates });
}
