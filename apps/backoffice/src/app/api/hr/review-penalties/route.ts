import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/hr/review-penalties?status=pending|applied|dismissed|all&outletId=xxx
// Returns the review-penalty queue. Pending by default.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "pending";
  const outletId = searchParams.get("outletId");

  let q = hrSupabaseAdmin
    .from("hr_review_penalty")
    .select("id, gbp_review_id, outlet_id, review_date, review_timestamp, rating, review_text, reviewer_name, status, attributed_user_ids, penalty_amount, reviewed_by, reviewed_at, dismiss_reason, created_at")
    .order("review_date", { ascending: false })
    .order("review_timestamp", { ascending: false, nullsFirst: false })
    .limit(200);

  if (status !== "all") q = q.eq("status", status);
  if (outletId) q = q.eq("outlet_id", outletId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with outlet names + staff on shift + attributed-user names
  const outletIds = Array.from(new Set((data || []).map((r: { outlet_id: string }) => r.outlet_id)));
  const outlets = await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } });
  const outletMap = new Map(outlets.map((o) => [o.id, o.name]));

  const allUserIds = new Set<string>();
  (data || []).forEach((r: { attributed_user_ids: string[] }) => {
    (r.attributed_user_ids || []).forEach((u) => allUserIds.add(u));
  });

  // For each pending row, compute suggested attribution:
  //   Primary: staff ACTUALLY CLOCKED IN at the review timestamp (attendance logs)
  //   Fallback: staff scheduled that day (if no attendance logs exist, e.g. old reviews)
  const suggestions = new Map<string, { user_id: string; name: string | null; fullName: string | null; source: "attendance" | "schedule" }[]>();
  for (const row of data || []) {
    const typed = row as {
      id: string;
      outlet_id: string;
      review_date: string;
      review_timestamp: string | null;
      status: string;
    };
    if (typed.status !== "pending") continue;

    let userIds: string[] = [];
    let source: "attendance" | "schedule" = "attendance";

    // 1. Attendance-based: staff clocked in at review timestamp
    if (typed.review_timestamp) {
      const ts = typed.review_timestamp;
      const { data: logs } = await hrSupabaseAdmin
        .from("hr_attendance_logs")
        .select("user_id, clock_in, clock_out")
        .eq("outlet_id", typed.outlet_id)
        .lte("clock_in", ts)
        .or(`clock_out.gte.${ts},clock_out.is.null`);
      userIds = Array.from(new Set((logs || []).map((l: { user_id: string }) => l.user_id)));
    }

    // 2. Fallback to schedule if no attendance data for that day
    if (userIds.length === 0) {
      source = "schedule";
      const { data: shifts } = await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .select("user_id")
        .eq("outlet_id", typed.outlet_id)
        .eq("shift_date", typed.review_date);
      userIds = Array.from(new Set((shifts || []).map((s: { user_id: string }) => s.user_id)));
    }

    userIds.forEach((u) => allUserIds.add(u));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, fullName: true },
    });
    suggestions.set(
      typed.id,
      users.map((u) => ({ user_id: u.id, name: u.name, fullName: u.fullName, source })),
    );
  }

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(allUserIds) } },
    select: { id: true, name: true, fullName: true },
  });
  const userMap = new Map(users.map((u) => [u.id, { name: u.name, fullName: u.fullName }]));

  const enriched = (data || []).map((r: {
    id: string; outlet_id: string; attributed_user_ids: string[]; status: string;
  }) => ({
    ...r,
    outletName: outletMap.get(r.outlet_id) || null,
    attributed: (r.attributed_user_ids || []).map((id) => ({ id, ...(userMap.get(id) || { name: null, fullName: null }) })),
    suggestedAttribution: suggestions.get(r.id) || [],
  }));

  return NextResponse.json({ items: enriched });
}
