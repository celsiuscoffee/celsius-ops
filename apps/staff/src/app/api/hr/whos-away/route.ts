import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/hr/whos-away — staff are curious about who's off today/tomorrow.
// Returns approved leave requests overlapping today + tomorrow, scoped to
// the same outlet as the caller (so an outlet's barista doesn't see HQ
// staff on holiday). OWNER/ADMIN/MANAGER see everyone.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);

  // Pull approved/AI-approved leave requests overlapping today or tomorrow.
  const { data: leaves, error } = await supabase
    .from("hr_leave_requests")
    .select("user_id, leave_type, start_date, end_date, status")
    .in("status", ["approved", "ai_approved"])
    .lte("start_date", tomorrow)
    .gte("end_date", todayIso);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!leaves || leaves.length === 0) {
    return NextResponse.json({ today: [], tomorrow: [] });
  }

  const userIds = Array.from(new Set(leaves.map((l: { user_id: string }) => l.user_id)));
  // Scope: managers see everyone in the company; staff see only their outlet.
  const isManager = ["OWNER", "ADMIN", "MANAGER"].includes(session.role);
  const users = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      ...(isManager || !session.outletId
        ? {}
        : { outletIds: { has: session.outletId } }),
    },
    select: { id: true, name: true, fullName: true, outlet: { select: { name: true } } },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  type Item = { user_id: string; name: string; full_name: string | null; outlet: string | null; leave_type: string; start_date: string; end_date: string };
  const todayList: Item[] = [];
  const tomorrowList: Item[] = [];
  for (const l of leaves as Array<{ user_id: string; leave_type: string; start_date: string; end_date: string }>) {
    const u = userMap.get(l.user_id);
    if (!u) continue;
    const item: Item = {
      user_id: l.user_id,
      name: u.fullName || u.name,
      full_name: u.fullName || null,
      outlet: u.outlet?.name || null,
      leave_type: l.leave_type,
      start_date: l.start_date,
      end_date: l.end_date,
    };
    if (l.start_date <= todayIso && l.end_date >= todayIso) todayList.push(item);
    if (l.start_date <= tomorrow && l.end_date >= tomorrow) tomorrowList.push(item);
  }

  return NextResponse.json({ today: todayList, tomorrow: tomorrowList });
}
