import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews } from "@/lib/reviews/gbp";

export const dynamic = "force-dynamic";

// GET /api/hr/performance?year=2026&month=4&outletId=xxx
// Returns per-staff performance aggregates for the month.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
  const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));
  const outletFilter = searchParams.get("outletId");

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndDate = new Date(year, month, 0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const monthStartIso = `${monthStart}T00:00:00Z`;
  const monthEndIso = `${monthEnd}T23:59:59Z`;

  // 1. Staff (filtered to scheduled employees at outlet if given)
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      role: { in: ["STAFF", "MANAGER"] },
      ...(outletFilter ? { OR: [{ outletId: outletFilter }, { outletIds: { has: outletFilter } }] } : {}),
    },
    select: { id: true, name: true, fullName: true, role: true, outletId: true, outletIds: true, outlet: { select: { name: true, id: true } } },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return NextResponse.json({ staff: [], reviews: [] });

  // 2. HR profiles (for schedule_required filter)
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, schedule_required, position, basic_salary, hourly_rate, employment_type")
    .in("user_id", userIds);
  const profileMap = new Map((profiles || []).map((p: { user_id: string }) => [p.user_id, p]));

  // 3. Attendance logs for the month
  const { data: attendance } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("user_id, outlet_id, clock_in, clock_out, lateness_minutes, regular_hours, overtime_hours, ai_flags, final_status")
    .in("user_id", userIds)
    .gte("clock_in", monthStartIso)
    .lte("clock_in", monthEndIso);

  // 4. Scheduled shifts for the month
  const { data: scheduled } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("user_id, shift_date, start_time, end_time, break_minutes")
    .in("user_id", userIds)
    .gte("shift_date", monthStart)
    .lte("shift_date", monthEnd);

  // 5. OT approvals
  const { data: otReqs } = await hrSupabaseAdmin
    .from("hr_overtime_requests")
    .select("user_id, hours_approved, hours_requested, status")
    .in("user_id", userIds)
    .gte("date", monthStart)
    .lte("date", monthEnd);

  // 6. Leave requests
  const { data: leaves } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("user_id, start_date, end_date, total_days, leave_type, status")
    .in("user_id", userIds)
    .in("status", ["approved", "ai_approved", "pending"])
    .gte("start_date", monthStart)
    .lte("end_date", monthEnd);

  // 7. Checklist completion (ops compliance)
  const checklistData = await prisma.checklist.findMany({
    where: {
      assignedToId: { in: userIds },
      createdAt: { gte: new Date(monthStartIso), lte: new Date(monthEndIso) },
    },
    select: { assignedToId: true, status: true },
  });

  // 8. Reviews from GBP per outlet (for staff-on-shift cross-ref)
  const outletsToCheck = outletFilter
    ? [outletFilter]
    : Array.from(new Set(users.flatMap((u) => [...(u.outletIds || []), u.outletId].filter(Boolean) as string[])));

  const reviewSettings = await prisma.reviewSettings.findMany({
    where: { outletId: { in: outletsToCheck } },
    select: { outletId: true, gbpAccountId: true, gbpLocationName: true, outlet: { select: { id: true, name: true } } },
  });

  type ReviewWithContext = {
    id: string;
    outletId: string;
    outletName: string;
    rating: number;
    comment?: string;
    reviewer: string;
    createdAt: string;
    staffOnShift: { userId: string; name: string }[];
  };
  const reviews: ReviewWithContext[] = [];

  // Helper: for a given outletId + timestamp, find staff clocked in
  const staffOnShiftAt = (outletId: string, timestamp: string) => {
    const t = new Date(timestamp).getTime();
    return (attendance || [])
      .filter((a: { outlet_id: string; clock_in: string; clock_out: string | null; user_id: string }) => {
        if (a.outlet_id !== outletId) return false;
        const inT = new Date(a.clock_in).getTime();
        const outT = a.clock_out ? new Date(a.clock_out).getTime() : Date.now();
        return t >= inT && t <= outT;
      })
      .map((a: { user_id: string }) => {
        const u = users.find((u) => u.id === a.user_id);
        return { userId: a.user_id, name: u?.name || a.user_id };
      });
  };

  for (const s of reviewSettings) {
    if (!s.gbpAccountId || !s.gbpLocationName || !s.outlet) continue;
    try {
      const data = await fetchGoogleReviews(s.gbpAccountId, s.gbpLocationName, 50);
      const monthReviews = (data.reviews || []).filter(
        (r) => r.createdAt >= monthStartIso && r.createdAt <= monthEndIso,
      );
      for (const r of monthReviews) {
        reviews.push({
          id: r.id,
          outletId: s.outletId,
          outletName: s.outlet.name,
          rating: r.rating,
          comment: r.comment,
          reviewer: r.reviewer.name,
          createdAt: r.createdAt,
          staffOnShift: staffOnShiftAt(s.outletId, r.createdAt),
        });
      }
    } catch (err) {
      console.error(`GBP fetch error for ${s.outlet.name}:`, err);
    }
  }

  // 9. Aggregate per-staff
  type StaffPerf = {
    userId: string;
    name: string;
    fullName: string | null;
    role: string;
    outletName: string | null;
    position: string | null;
    employment_type: string | null;
    // attendance
    clockIns: number;
    lateCount: number;
    totalLateMinutes: number;
    avgLateMinutes: number;
    // hours
    scheduledHours: number;
    actualHours: number;
    otHours: number;
    // leave
    leaveDays: number;
    // compliance
    checklistsAssigned: number;
    checklistsCompleted: number;
    opsCompletionRate: number;
    // reviews
    reviewsOnShift: number;
    avgReviewRating: number;
    // composite
    score: number;
  };

  const perfMap = new Map<string, StaffPerf>();
  users.forEach((u) => {
    const p = profileMap.get(u.id);
    perfMap.set(u.id, {
      userId: u.id,
      name: u.name,
      fullName: u.fullName,
      role: u.role,
      outletName: u.outlet?.name || null,
      position: (p as { position?: string })?.position || null,
      employment_type: (p as { employment_type?: string })?.employment_type || null,
      clockIns: 0,
      lateCount: 0,
      totalLateMinutes: 0,
      avgLateMinutes: 0,
      scheduledHours: 0,
      actualHours: 0,
      otHours: 0,
      leaveDays: 0,
      checklistsAssigned: 0,
      checklistsCompleted: 0,
      opsCompletionRate: 0,
      reviewsOnShift: 0,
      avgReviewRating: 0,
      score: 0,
    });
  });

  // Attendance aggregates
  (attendance || []).forEach((a: { user_id: string; lateness_minutes: number | null; regular_hours: number | null; overtime_hours: number | null; final_status: string | null }) => {
    const p = perfMap.get(a.user_id);
    if (!p) return;
    p.clockIns += 1;
    if ((a.lateness_minutes || 0) > 0) p.lateCount += 1;
    p.totalLateMinutes += a.lateness_minutes || 0;
    p.actualHours += Number(a.regular_hours || 0);
    p.otHours += Number(a.overtime_hours || 0);
  });
  perfMap.forEach((p) => { p.avgLateMinutes = p.clockIns > 0 ? Math.round((p.totalLateMinutes / p.clockIns) * 10) / 10 : 0; });

  // Scheduled hours
  const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
  (scheduled || []).forEach((s: { user_id: string; start_time: string; end_time: string; break_minutes: number | null }) => {
    const p = perfMap.get(s.user_id);
    if (!p) return;
    const dur = toMin(s.end_time) - toMin(s.start_time) - (s.break_minutes || 0);
    if (dur > 0) p.scheduledHours += dur / 60;
  });

  // OT (use approved from requests if they exist — fallback to attendance)
  (otReqs || []).forEach((r: { user_id: string; hours_approved: number | null; status: string }) => {
    const p = perfMap.get(r.user_id);
    if (!p) return;
    if (r.status === "approved" || r.status === "partial") {
      // already counted via attendance.overtime_hours, but ensure minimum
      p.otHours = Math.max(p.otHours, Number(r.hours_approved || 0));
    }
  });

  // Leave
  (leaves || []).forEach((l: { user_id: string; total_days: number | null }) => {
    const p = perfMap.get(l.user_id);
    if (!p) return;
    p.leaveDays += Number(l.total_days || 0);
  });

  // Ops compliance
  checklistData.forEach((c) => {
    if (!c.assignedToId) return;
    const p = perfMap.get(c.assignedToId);
    if (!p) return;
    p.checklistsAssigned += 1;
    if (c.status === "COMPLETED") p.checklistsCompleted += 1;
  });
  perfMap.forEach((p) => {
    p.opsCompletionRate = p.checklistsAssigned > 0
      ? Math.round((p.checklistsCompleted / p.checklistsAssigned) * 100)
      : 0;
  });

  // Reviews cross-reference
  for (const r of reviews) {
    for (const s of r.staffOnShift) {
      const p = perfMap.get(s.userId);
      if (!p) continue;
      p.reviewsOnShift += 1;
      p.avgReviewRating = (p.avgReviewRating * (p.reviewsOnShift - 1) + r.rating) / p.reviewsOnShift;
    }
  }
  perfMap.forEach((p) => { p.avgReviewRating = Math.round(p.avgReviewRating * 10) / 10; });

  // Composite score (0-100)
  // - 30% punctuality: 100 - (avgLateMinutes × 5) capped at 0
  // - 20% hours efficiency: actual / scheduled (capped 100)
  // - 20% ops compliance
  // - 20% review rating (×20)
  // - 10% no-unapproved-OT bonus
  perfMap.forEach((p) => {
    const punctuality = Math.max(0, 100 - p.avgLateMinutes * 5);
    const hoursEff = p.scheduledHours > 0 ? Math.min(100, (p.actualHours / p.scheduledHours) * 100) : (p.actualHours > 0 ? 100 : 0);
    const reviewScore = p.reviewsOnShift > 0 ? p.avgReviewRating * 20 : 60; // neutral 60 if no reviews
    p.score = Math.round(
      (punctuality * 0.3) +
      (hoursEff * 0.2) +
      (p.opsCompletionRate * 0.2) +
      (reviewScore * 0.2) +
      10,
    );
  });

  const staff = Array.from(perfMap.values())
    .filter((p) => {
      const pr = profileMap.get(p.userId) as { schedule_required?: boolean } | undefined;
      return pr?.schedule_required !== false;
    })
    .sort((a, b) => b.score - a.score);

  return NextResponse.json({
    period: { year, month, start: monthStart, end: monthEnd },
    staff,
    reviews: reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
}
