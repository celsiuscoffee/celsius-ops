// Staff-app allowance computation. Mirrors logic in apps/backoffice/src/lib/hr/allowances.ts
// Divergence: staff app has no GBP credentials, so the "reviews" component of the performance
// score falls back to neutral (60). Review-penalty deductions still apply (they're rows in
// hr_review_penalty, readable via shared Supabase).
import { supabase } from "../supabase";
import { prisma } from "../prisma";

export type AllowanceBreakdown = {
  userId: string;
  employmentType: string | null;
  isFullTime: boolean;
  period: { year: number; month: number; daysElapsed: number; daysRemaining: number };
  attendance: {
    base: number;
    earned: number;
    penalties: { kind: string; label: string; amount: number; date?: string }[];
    metrics: { lateCount: number; absentCount: number; earlyOutCount: number; missedClockoutCount: number; exceededBreakCount: number };
    tip: string;
  };
  performance: {
    base: number;
    earned: number;
    score: number;
    mode: "tiered" | "linear";
    eligible: boolean;
    breakdown: { checklists: number; reviews: number; audit: number };
    tip: string;
  };
  reviewPenalty: {
    total: number;
    entries: { id: string; reviewDate: string; rating: number; amount: number; reviewText?: string | null }[];
  };
  totalEarned: number;
  totalMax: number;
};

async function loadRules() {
  const { data } = await supabase
    .from("hr_company_settings")
    .select("attendance_allowance_amount, attendance_penalty_absent, attendance_penalty_early_out, attendance_penalty_missed_clockout, attendance_penalty_exceeded_break, attendance_late_tier_1_max_minutes, attendance_late_tier_2_max_minutes, attendance_late_tier_3_max_minutes, attendance_late_tier_4_max_minutes, attendance_late_tier_2_penalty, attendance_late_tier_3_penalty, attendance_late_tier_4_penalty, attendance_early_out_threshold_minutes, performance_allowance_amount, performance_allowance_mode, performance_tier_full_threshold, performance_tier_half_threshold, performance_tier_quarter_threshold, perf_weight_checklists, perf_weight_reviews, perf_weight_audit, review_penalty_amount")
    .limit(1)
    .maybeSingle();
  return {
    attBase: Number(data?.attendance_allowance_amount ?? 100),
    penAbsent: Number(data?.attendance_penalty_absent ?? 20),
    penEarlyOut: Number(data?.attendance_penalty_early_out ?? 10),
    penMissedClockout: Number(data?.attendance_penalty_missed_clockout ?? 5),
    penExceededBreak: Number(data?.attendance_penalty_exceeded_break ?? 3),
    lateTier1Max: Number(data?.attendance_late_tier_1_max_minutes ?? 5),
    lateTier2Max: Number(data?.attendance_late_tier_2_max_minutes ?? 15),
    lateTier3Max: Number(data?.attendance_late_tier_3_max_minutes ?? 30),
    lateTier4Max: Number(data?.attendance_late_tier_4_max_minutes ?? 60),
    lateTier2Pen: Number(data?.attendance_late_tier_2_penalty ?? 5),
    lateTier3Pen: Number(data?.attendance_late_tier_3_penalty ?? 10),
    lateTier4Pen: Number(data?.attendance_late_tier_4_penalty ?? 15),
    earlyOutThresh: Number(data?.attendance_early_out_threshold_minutes ?? 30),
    perfBase: Number(data?.performance_allowance_amount ?? 100),
    perfMode: (data?.performance_allowance_mode as "tiered" | "linear") ?? "tiered",
    tierFull: Number(data?.performance_tier_full_threshold ?? 85),
    tierHalf: Number(data?.performance_tier_half_threshold ?? 70),
    tierQuarter: Number(data?.performance_tier_quarter_threshold ?? 60),
    weightChecklists: Number(data?.perf_weight_checklists ?? 40),
    weightReviews: Number(data?.perf_weight_reviews ?? 30),
    weightAudit: Number(data?.perf_weight_audit ?? 30),
  };
}

export async function computeAllowances(userId: string, year: number, month: number): Promise<AllowanceBreakdown> {
  const r = await loadRules();
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndDate = new Date(year, month, 0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const today = new Date();
  const isCurrent = today.getFullYear() === year && today.getMonth() + 1 === month;
  const endForElapsed = isCurrent ? today : monthEndDate;
  const daysElapsed = Math.min(endForElapsed.getDate(), monthEndDate.getDate());
  const daysRemaining = Math.max(0, monthEndDate.getDate() - daysElapsed);

  // Employment type
  const { data: profile } = await supabase
    .from("hr_employee_profiles")
    .select("employment_type")
    .eq("user_id", userId)
    .maybeSingle();
  const employmentType = profile?.employment_type ?? null;
  const isFullTime = employmentType === "full_time";

  const [attResp, schedResp, leavesResp, rpResp] = await Promise.all([
    supabase.from("hr_attendance_logs").select("id, clock_in, clock_out, lateness_minutes, ai_flags, scheduled_end").eq("user_id", userId).gte("clock_in", `${monthStart}T00:00:00Z`).lte("clock_in", `${monthEnd}T23:59:59Z`),
    supabase.from("hr_schedule_shifts").select("shift_date, start_time, end_time").eq("user_id", userId).gte("shift_date", monthStart).lte("shift_date", monthEnd),
    supabase.from("hr_leave_requests").select("start_date, end_date").eq("user_id", userId).in("status", ["approved", "ai_approved"]).gte("start_date", monthStart).lte("end_date", monthEnd),
    supabase.from("hr_review_penalty").select("id, review_date, rating, penalty_amount, review_text, attributed_user_ids").eq("status", "applied").gte("review_date", monthStart).lte("review_date", monthEnd).contains("attributed_user_ids", [userId]),
  ]);

  const logs = (attResp.data || []) as { id: string; clock_in: string; clock_out: string | null; lateness_minutes: number | null; ai_flags: string[] | null; scheduled_end: string | null }[];
  const scheduled = (schedResp.data || []) as { shift_date: string; start_time: string; end_time: string }[];
  const leaves = (leavesResp.data || []) as { start_date: string; end_date: string }[];

  const leaveDays = new Set<string>();
  leaves.forEach((l) => {
    const s = new Date(l.start_date);
    const e = new Date(l.end_date);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      leaveDays.add(d.toISOString().slice(0, 10));
    }
  });

  const penalties: AllowanceBreakdown["attendance"]["penalties"] = [];
  const metrics = { lateCount: 0, absentCount: 0, earlyOutCount: 0, missedClockoutCount: 0, exceededBreakCount: 0 };

  const applyLateTier = (lateMin: number, date?: string) => {
    if (lateMin > r.lateTier4Max) {
      penalties.push({ kind: "absent", label: `Very late (${Math.round(lateMin)}m) — counted as absent`, amount: r.penAbsent, date });
      metrics.absentCount++;
    } else if (lateMin > r.lateTier3Max) {
      penalties.push({ kind: "late", label: `Late ${Math.round(lateMin)}m (tier 4)`, amount: r.lateTier4Pen, date });
      metrics.lateCount++;
    } else if (lateMin > r.lateTier2Max) {
      penalties.push({ kind: "late", label: `Late ${Math.round(lateMin)}m (tier 3)`, amount: r.lateTier3Pen, date });
      metrics.lateCount++;
    } else if (lateMin > r.lateTier1Max) {
      penalties.push({ kind: "late", label: `Late ${Math.round(lateMin)}m (tier 2)`, amount: r.lateTier2Pen, date });
      metrics.lateCount++;
    }
  };

  // clock_in is stored as UTC timestamptz. Convert to Malaysian local date
  // (UTC+8) so morning shifts (7:30am MYT = 23:30 UTC previous day) match
  // the schedule's shift_date correctly.
  const toMytDate = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    // Offset to MYT and take the YYYY-MM-DD portion
    return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  };

  for (const log of logs) {
    const date = toMytDate(log.clock_in);
    applyLateTier(log.lateness_minutes || 0, date);

    if (!log.clock_out) {
      penalties.push({ kind: "missed_clockout", label: "Missed clock-out", amount: r.penMissedClockout, date });
      metrics.missedClockoutCount++;
    } else if (log.scheduled_end) {
      const earlyMin = (new Date(log.scheduled_end).getTime() - new Date(log.clock_out).getTime()) / 60000;
      if (earlyMin > r.earlyOutThresh) {
        penalties.push({ kind: "early_out", label: `Left ${Math.round(earlyMin)}m early`, amount: r.penEarlyOut, date });
        metrics.earlyOutCount++;
      }
    }
    if (Array.isArray(log.ai_flags) && log.ai_flags.includes("exceeded_break")) {
      penalties.push({ kind: "exceeded_break", label: "Exceeded break", amount: r.penExceededBreak, date });
      metrics.exceededBreakCount++;
    }
  }

  const loggedDates = new Set(logs.map((l) => toMytDate(l.clock_in)));
  const todayIso = today.toISOString().slice(0, 10);
  for (const sh of scheduled) {
    if (sh.shift_date >= todayIso) continue;
    if (loggedDates.has(sh.shift_date)) continue;
    if (leaveDays.has(sh.shift_date)) continue;
    penalties.push({ kind: "absent", label: "No-show", amount: r.penAbsent, date: sh.shift_date });
    metrics.absentCount++;
  }

  const attendanceBase = isFullTime ? r.attBase : 0;
  const attendanceEarned = Math.max(
    0,
    attendanceBase - (isFullTime ? penalties.reduce((s, p) => s + p.amount, 0) : 0),
  );

  let attendanceTip: string;
  if (!isFullTime) {
    attendanceTip = "Attendance allowance is for full-time staff only.";
  } else if (metrics.absentCount > 0) {
    attendanceTip = `You missed ${metrics.absentCount} shift${metrics.absentCount > 1 ? "s" : ""}. Attend the rest to protect your allowance.`;
  } else if (metrics.lateCount > 0) {
    attendanceTip = `Be on time for the next ${Math.min(3, daysRemaining)} clock-ins to stay on track.`;
  } else if (metrics.earlyOutCount > 0) {
    attendanceTip = "Avoid leaving before your scheduled end-time.";
  } else {
    attendanceTip = "Perfect attendance — keep it up!";
  }

  // Performance (FT only)
  const { score, parts } = isFullTime
    ? await computeScore(userId, year, month, r)
    : { score: 0, parts: { checklists: 0, reviews: 0, audit: 0 } };

  let performanceEarned = 0;
  if (!isFullTime) {
    performanceEarned = 0;
  } else if (r.perfMode === "linear") {
    performanceEarned = Math.round(r.perfBase * (score / 100) * 100) / 100;
  } else {
    if (score >= r.tierFull) performanceEarned = r.perfBase;
    else if (score >= r.tierHalf) performanceEarned = r.perfBase / 2;
    else if (score >= r.tierQuarter) performanceEarned = r.perfBase / 4;
    else performanceEarned = 0;
  }

  let performanceTip = "";
  if (!isFullTime) {
    performanceTip = "Performance allowance is for full-time staff only.";
  } else if (r.perfMode === "tiered") {
    if (score < r.tierQuarter) performanceTip = `Reach ${r.tierQuarter}+ to earn RM ${r.perfBase / 4}.`;
    else if (score < r.tierHalf) performanceTip = `Reach ${r.tierHalf}+ for RM ${r.perfBase / 2}.`;
    else if (score < r.tierFull) performanceTip = `Reach ${r.tierFull}+ for the full RM ${r.perfBase}.`;
    else performanceTip = "Top tier — amazing!";
  } else {
    performanceTip = `Every point = RM ${(r.perfBase / 100).toFixed(2)}.`;
  }

  // Review penalty
  const reviewPenaltyEntries = (rpResp.data || []).map((row: { id: string; review_date: string; rating: number; penalty_amount: number; review_text: string | null }) => ({
    id: row.id,
    reviewDate: row.review_date,
    rating: row.rating,
    amount: Number(row.penalty_amount),
    reviewText: row.review_text,
  }));
  const reviewPenaltyTotal = reviewPenaltyEntries.reduce((s, e) => s + e.amount, 0);

  const totalEarned = Math.max(0, attendanceEarned + performanceEarned - reviewPenaltyTotal);

  return {
    userId,
    employmentType,
    isFullTime,
    period: { year, month, daysElapsed, daysRemaining },
    attendance: { base: attendanceBase, earned: attendanceEarned, penalties, metrics, tip: attendanceTip },
    performance: {
      base: isFullTime ? r.perfBase : 0,
      earned: performanceEarned,
      score,
      mode: r.perfMode,
      eligible: isFullTime,
      breakdown: parts,
      tip: performanceTip,
    },
    reviewPenalty: { total: reviewPenaltyTotal, entries: reviewPenaltyEntries },
    totalEarned: Math.round(totalEarned * 100) / 100,
    totalMax: isFullTime ? r.attBase + r.perfBase : 0,
  };
}

async function computeScore(
  userId: string,
  year: number,
  month: number,
  r: Awaited<ReturnType<typeof loadRules>>,
): Promise<{ score: number; parts: { checklists: number; reviews: number; audit: number } }> {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
  const monthStartIso = `${monthStart}T00:00:00Z`;
  const monthEndIso = `${monthEnd}T23:59:59Z`;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, fullName: true, outletId: true } });
  if (!user?.outletId) return { score: 0, parts: { checklists: 0, reviews: 0, audit: 0 } };

  // Checklists — team-avg relative within outlet
  let checklistScore = 50;
  try {
    const outletChecklists = await prisma.checklist.findMany({
      where: { outletId: user.outletId, createdAt: { gte: new Date(monthStartIso), lte: new Date(monthEndIso) }, assignedToId: { not: null } },
      select: { status: true, assignedToId: true },
    });
    const byUser = new Map<string, { total: number; done: number }>();
    for (const c of outletChecklists) {
      if (!c.assignedToId) continue;
      const entry = byUser.get(c.assignedToId) || { total: 0, done: 0 };
      entry.total++;
      if (c.status === "COMPLETED") entry.done++;
      byUser.set(c.assignedToId, entry);
    }
    const rates = Array.from(byUser.values()).filter((v) => v.total > 0).map((v) => (v.done / v.total) * 100);
    const teamAvg = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    const mine = byUser.get(userId);
    const myRate = mine && mine.total > 0 ? (mine.done / mine.total) * 100 : 0;
    if (rates.length === 0 || teamAvg === 0) checklistScore = 50;
    else if (myRate >= teamAvg) checklistScore = 100;
    else checklistScore = Math.max(0, (myRate / teamAvg) * 100);
  } catch { /* ignore */ }

  // Reviews — staff app has no GBP access, neutral default
  const reviewScore = 60;

  // Audit
  let auditPositive = 0;
  let auditNegative = 0;
  try {
    const auditReports = await prisma.auditReport.findMany({
      where: { completedAt: { gte: new Date(monthStartIso), lte: new Date(monthEndIso) }, status: "COMPLETED" },
      select: { overallScore: true, overallNotes: true, items: { select: { notes: true, rating: true } } },
    });
    const tokens = [user?.name, user?.fullName, user?.name?.split(/\s+/)[0], user?.fullName?.split(/\s+/)[0]].filter((t): t is string => !!t && t.length >= 3);
    for (const rpt of auditReports) {
      const txt = [rpt.overallNotes || "", ...(rpt.items || []).map((i) => i.notes || "")].join(" \n ");
      if (!txt.trim()) continue;
      const hit = tokens.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(txt));
      if (!hit) continue;
      const sc = rpt.overallScore ? Number(rpt.overallScore) : null;
      const itemRatings = (rpt.items || []).map((i) => i.rating).filter((x): x is number => x != null);
      const avgItem = itemRatings.length > 0 ? itemRatings.reduce((a, b) => a + b, 0) / itemRatings.length : null;
      if ((sc !== null && sc >= 80) || (avgItem !== null && avgItem >= 4)) auditPositive++;
      else if ((sc !== null && sc < 60) || (avgItem !== null && avgItem <= 2)) auditNegative++;
    }
  } catch { /* ignore */ }
  const auditScore = Math.max(0, Math.min(100, 70 + auditPositive * 10 - auditNegative * 20));

  const wSum = r.weightChecklists + r.weightReviews + r.weightAudit;
  const wC = r.weightChecklists / wSum;
  const wR = r.weightReviews / wSum;
  const wA = r.weightAudit / wSum;
  const score = Math.round(checklistScore * wC + reviewScore * wR + auditScore * wA);

  return {
    score: Math.max(0, Math.min(100, score)),
    parts: { checklists: Math.round(checklistScore), reviews: Math.round(reviewScore), audit: Math.round(auditScore) },
  };
}
