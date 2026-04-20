// Shared allowance computation — used by both backoffice and staff APIs.
// Model (FT only — part-time / contract / intern staff are not eligible):
//   Attendance allowance (FT only)   = PUNISH. Base amount, deduct penalties.
//   Performance allowance (FT only)  = AWARD.  Score = 40% checklists (team-avg) + 30% reviews + 30% audit.
//   Review penalty (separate line)   = flat deduction applied by manager review.
import { hrSupabaseAdmin } from "./supabase";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews } from "@/lib/reviews/gbp";

export type AllowanceRules = {
  attendance_allowance_amount: number;
  attendance_penalty_absent: number;
  attendance_penalty_early_out: number;
  attendance_penalty_missed_clockout: number;
  attendance_penalty_exceeded_break: number;
  attendance_late_tier_1_max_minutes: number;
  attendance_late_tier_2_max_minutes: number;
  attendance_late_tier_3_max_minutes: number;
  attendance_late_tier_4_max_minutes: number;
  attendance_late_tier_2_penalty: number;
  attendance_late_tier_3_penalty: number;
  attendance_late_tier_4_penalty: number;
  attendance_early_out_threshold_minutes: number;
  attendance_break_overage_threshold_minutes: number;
  performance_allowance_amount: number;
  performance_allowance_mode: "tiered" | "linear";
  performance_tier_full_threshold: number;
  performance_tier_half_threshold: number;
  performance_tier_quarter_threshold: number;
  perf_weight_checklists: number;
  perf_weight_reviews: number;
  perf_weight_audit: number;
  review_penalty_amount: number;
};

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

export async function loadAllowanceRules(): Promise<AllowanceRules> {
  const { data } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select("attendance_allowance_amount, attendance_penalty_absent, attendance_penalty_early_out, attendance_penalty_missed_clockout, attendance_penalty_exceeded_break, attendance_late_tier_1_max_minutes, attendance_late_tier_2_max_minutes, attendance_late_tier_3_max_minutes, attendance_late_tier_4_max_minutes, attendance_late_tier_2_penalty, attendance_late_tier_3_penalty, attendance_late_tier_4_penalty, attendance_early_out_threshold_minutes, attendance_break_overage_threshold_minutes, performance_allowance_amount, performance_allowance_mode, performance_tier_full_threshold, performance_tier_half_threshold, performance_tier_quarter_threshold, perf_weight_checklists, perf_weight_reviews, perf_weight_audit, review_penalty_amount")
    .limit(1)
    .maybeSingle();
  return {
    attendance_allowance_amount: Number(data?.attendance_allowance_amount ?? 100),
    attendance_penalty_absent: Number(data?.attendance_penalty_absent ?? 20),
    attendance_penalty_early_out: Number(data?.attendance_penalty_early_out ?? 10),
    attendance_penalty_missed_clockout: Number(data?.attendance_penalty_missed_clockout ?? 5),
    attendance_penalty_exceeded_break: Number(data?.attendance_penalty_exceeded_break ?? 3),
    attendance_late_tier_1_max_minutes: Number(data?.attendance_late_tier_1_max_minutes ?? 5),
    attendance_late_tier_2_max_minutes: Number(data?.attendance_late_tier_2_max_minutes ?? 15),
    attendance_late_tier_3_max_minutes: Number(data?.attendance_late_tier_3_max_minutes ?? 30),
    attendance_late_tier_4_max_minutes: Number(data?.attendance_late_tier_4_max_minutes ?? 60),
    attendance_late_tier_2_penalty: Number(data?.attendance_late_tier_2_penalty ?? 5),
    attendance_late_tier_3_penalty: Number(data?.attendance_late_tier_3_penalty ?? 10),
    attendance_late_tier_4_penalty: Number(data?.attendance_late_tier_4_penalty ?? 15),
    attendance_early_out_threshold_minutes: Number(data?.attendance_early_out_threshold_minutes ?? 30),
    attendance_break_overage_threshold_minutes: Number(data?.attendance_break_overage_threshold_minutes ?? 15),
    performance_allowance_amount: Number(data?.performance_allowance_amount ?? 100),
    performance_allowance_mode: (data?.performance_allowance_mode as "tiered" | "linear") ?? "tiered",
    performance_tier_full_threshold: Number(data?.performance_tier_full_threshold ?? 85),
    performance_tier_half_threshold: Number(data?.performance_tier_half_threshold ?? 70),
    performance_tier_quarter_threshold: Number(data?.performance_tier_quarter_threshold ?? 60),
    perf_weight_checklists: Number(data?.perf_weight_checklists ?? 40),
    perf_weight_reviews: Number(data?.perf_weight_reviews ?? 30),
    perf_weight_audit: Number(data?.perf_weight_audit ?? 30),
    review_penalty_amount: Number(data?.review_penalty_amount ?? 50),
  };
}

export async function computeAllowancesForUser(
  userId: string,
  year: number,
  month: number,
  rules?: AllowanceRules,
): Promise<AllowanceBreakdown> {
  const r = rules ?? (await loadAllowanceRules());

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndDate = new Date(year, month, 0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const endForElapsed = isCurrentMonth ? today : monthEndDate;
  const daysElapsed = Math.min(endForElapsed.getDate(), monthEndDate.getDate());
  const daysRemaining = Math.max(0, monthEndDate.getDate() - daysElapsed);

  // Employment type — FT gate for performance allowance.
  // schedule_required=false → staff doesn't work operational shifts (OWNER,
  // HQ roles) so attendance + performance allowances don't apply.
  // attendance_allowance_amount / performance_allowance_amount are per-staff
  // overrides; NULL falls back to the global rules loaded above.
  const { data: profile } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("employment_type, schedule_required, attendance_allowance_amount, performance_allowance_amount")
    .eq("user_id", userId)
    .maybeSingle();
  const employmentType = profile?.employment_type ?? null;
  const isFullTime = employmentType === "full_time";
  const scheduleRequired = profile?.schedule_required !== false;

  // Apply per-staff overrides on top of the global defaults. We do this before
  // the early return for schedule_required=false so the returned r object is
  // internally consistent (though those staff won't use these amounts).
  if (profile?.attendance_allowance_amount != null) {
    r.attendance_allowance_amount = Number(profile.attendance_allowance_amount);
  }
  if (profile?.performance_allowance_amount != null) {
    r.performance_allowance_amount = Number(profile.performance_allowance_amount);
  }
  if (!scheduleRequired) {
    // Non-operational staff (OWNER / HQ / role without scheduled shifts) —
    // no attendance or performance allowance. They're salaried and don't
    // clock in, so awarding "perfect attendance" RM100 is incorrect.
    return {
      userId,
      employmentType,
      isFullTime,
      period: { year, month, daysElapsed, daysRemaining },
      attendance: {
        base: 0, earned: 0, penalties: [],
        metrics: { lateCount: 0, absentCount: 0, earlyOutCount: 0, missedClockoutCount: 0, exceededBreakCount: 0 },
        tip: "Not applicable — schedule not required for this role",
      },
      performance: {
        base: 0, earned: 0, score: 0, mode: r.performance_allowance_mode, eligible: false,
        breakdown: { checklists: 0, reviews: 0, audit: 0 },
        tip: "Not applicable — schedule not required for this role",
      },
      reviewPenalty: { total: 0, entries: [] },
      totalEarned: 0,
      totalMax: 0,
    };
  }

  // 1. Attendance logs (lateness is computed from clock_in vs scheduled_start
  // below — the lateness_minutes column doesn't exist)
  const { data: logs } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id, clock_in, clock_out, ai_flags, final_status, scheduled_start, scheduled_end, excused")
    .eq("user_id", userId)
    .gte("clock_in", `${monthStart}T00:00:00Z`)
    .lte("clock_in", `${monthEnd}T23:59:59Z`);

  // 2. Scheduled shifts (for no-show detection)
  const { data: scheduled } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("shift_date, start_time, end_time")
    .eq("user_id", userId)
    .gte("shift_date", monthStart)
    .lte("shift_date", monthEnd);

  // 3. Approved leaves — don't count as absence
  const { data: leaves } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("start_date, end_date")
    .eq("user_id", userId)
    .in("status", ["approved", "ai_approved"])
    .gte("start_date", monthStart)
    .lte("end_date", monthEnd);
  const leaveDays = new Set<string>();
  (leaves || []).forEach((l: { start_date: string; end_date: string }) => {
    const s = new Date(l.start_date);
    const e = new Date(l.end_date);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      leaveDays.add(d.toISOString().slice(0, 10));
    }
  });

  // 4. Apply attendance penalties
  const penalties: AllowanceBreakdown["attendance"]["penalties"] = [];
  const metrics = { lateCount: 0, absentCount: 0, earlyOutCount: 0, missedClockoutCount: 0, exceededBreakCount: 0 };

  const minutesBetween = (a: string | null, b: string | null) => {
    if (!a || !b) return 0;
    return (new Date(a).getTime() - new Date(b).getTime()) / 60000;
  };

  const applyLateTier = (lateMin: number, date?: string) => {
    if (lateMin > r.attendance_late_tier_4_max_minutes) {
      penalties.push({ kind: "absent", label: `Very late (${Math.round(lateMin)}m) — counted as absent`, amount: r.attendance_penalty_absent, date });
      metrics.absentCount++;
    } else if (lateMin > r.attendance_late_tier_3_max_minutes) {
      penalties.push({ kind: "late", label: `Late ${Math.round(lateMin)}m (tier 4)`, amount: r.attendance_late_tier_4_penalty, date });
      metrics.lateCount++;
    } else if (lateMin > r.attendance_late_tier_2_max_minutes) {
      penalties.push({ kind: "late", label: `Late ${Math.round(lateMin)}m (tier 3)`, amount: r.attendance_late_tier_3_penalty, date });
      metrics.lateCount++;
    } else if (lateMin > r.attendance_late_tier_1_max_minutes) {
      penalties.push({ kind: "late", label: `Late ${Math.round(lateMin)}m (tier 2)`, amount: r.attendance_late_tier_2_penalty, date });
      metrics.lateCount++;
    }
    // within tier 1 (grace period) — no penalty
  };

  // clock_in is stored as UTC timestamptz. Convert to Malaysian local date
  // (UTC+8) so morning shifts (7:30am MYT = 23:30 UTC previous day) match
  // the schedule's shift_date correctly.
  const toMytDate = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  };

  const computeLateMin = (clockInIso: string, schedStart: string | null): number => {
    if (!schedStart) return 0;
    const d = new Date(clockInIso);
    const myt = new Date(d.getTime() + 8 * 3600 * 1000);
    const h = myt.getUTCHours(), m = myt.getUTCMinutes();
    const [sh, sm] = schedStart.split(":").map(Number);
    const delta = (h * 60 + m) - (sh * 60 + (sm || 0));
    return delta > 0 ? delta : 0;
  };
  for (const log of (logs || [])) {
    // Manager-excused logs skip all penalty calculations (legit reason given).
    if (log.excused) continue;
    const date = toMytDate(log.clock_in);
    applyLateTier(computeLateMin(log.clock_in, log.scheduled_start), date);

    if (!log.clock_out) {
      penalties.push({ kind: "missed_clockout", label: "Missed clock-out", amount: r.attendance_penalty_missed_clockout, date });
      metrics.missedClockoutCount++;
    } else if (log.scheduled_end) {
      const earlyMin = -minutesBetween(log.clock_out, log.scheduled_end);
      if (earlyMin > r.attendance_early_out_threshold_minutes) {
        penalties.push({ kind: "early_out", label: `Left ${Math.round(earlyMin)}m early`, amount: r.attendance_penalty_early_out, date });
        metrics.earlyOutCount++;
      }
    }
    if (Array.isArray(log.ai_flags) && log.ai_flags.includes("exceeded_break")) {
      penalties.push({ kind: "exceeded_break", label: "Exceeded break", amount: r.attendance_penalty_exceeded_break, date });
      metrics.exceededBreakCount++;
    }
  }

  const loggedDates = new Set((logs || []).map((l: { clock_in: string }) => toMytDate(l.clock_in)));
  const todayIso = today.toISOString().slice(0, 10);
  for (const sh of (scheduled || [])) {
    if (sh.shift_date >= todayIso) continue;
    if (loggedDates.has(sh.shift_date)) continue;
    if (leaveDays.has(sh.shift_date)) continue;
    penalties.push({ kind: "absent", label: "No-show (scheduled, didn't clock in)", amount: r.attendance_penalty_absent, date: sh.shift_date });
    metrics.absentCount++;
  }

  const attendanceBase = isFullTime ? r.attendance_allowance_amount : 0;
  const attendanceDeducted = isFullTime ? penalties.reduce((s, p) => s + p.amount, 0) : 0;
  const attendanceEarned = Math.max(0, attendanceBase - attendanceDeducted);

  let attendanceTip: string;
  if (!isFullTime) {
    attendanceTip = "Attendance allowance is for full-time staff only.";
  } else if (metrics.absentCount > 0) {
    attendanceTip = `You've missed ${metrics.absentCount} scheduled shift${metrics.absentCount > 1 ? "s" : ""}. Attend all remaining shifts to protect your allowance.`;
  } else if (metrics.lateCount > 0) {
    attendanceTip = `Be on time for the next ${Math.min(3, daysRemaining)} clock-ins to stay on track.`;
  } else if (metrics.earlyOutCount > 0) {
    attendanceTip = "Avoid leaving before your scheduled end-time.";
  } else {
    attendanceTip = "Perfect attendance so far — keep it up!";
  }

  // 5. Performance score — FT only
  const { score, parts } = isFullTime
    ? await computePerformanceScore(userId, year, month, r)
    : { score: 0, parts: { checklists: 0, reviews: 0, audit: 0 } };

  let performanceEarned = 0;
  if (!isFullTime) {
    performanceEarned = 0;
  } else if (r.performance_allowance_mode === "linear") {
    performanceEarned = Math.round(r.performance_allowance_amount * (score / 100) * 100) / 100;
  } else {
    if (score >= r.performance_tier_full_threshold) performanceEarned = r.performance_allowance_amount;
    else if (score >= r.performance_tier_half_threshold) performanceEarned = r.performance_allowance_amount / 2;
    else if (score >= r.performance_tier_quarter_threshold) performanceEarned = r.performance_allowance_amount / 4;
    else performanceEarned = 0;
  }

  let performanceTip = "";
  if (!isFullTime) {
    performanceTip = "Performance allowance is for full-time staff only.";
  } else if (r.performance_allowance_mode === "tiered") {
    if (score < r.performance_tier_quarter_threshold) performanceTip = `Reach ${r.performance_tier_quarter_threshold}+ to earn RM ${r.performance_allowance_amount / 4}. Focus on checklists, reviews, and audits.`;
    else if (score < r.performance_tier_half_threshold) performanceTip = `Reach ${r.performance_tier_half_threshold}+ for RM ${r.performance_allowance_amount / 2}.`;
    else if (score < r.performance_tier_full_threshold) performanceTip = `Reach ${r.performance_tier_full_threshold}+ for the full RM ${r.performance_allowance_amount}.`;
    else performanceTip = "You've hit the top tier — well done!";
  } else {
    performanceTip = score < 100 ? `Every point = RM ${(r.performance_allowance_amount / 100).toFixed(2)}.` : "Perfect score!";
  }

  // 6. Review penalties (applied status, attributed to this user, for this period)
  const { data: rpRows } = await hrSupabaseAdmin
    .from("hr_review_penalty")
    .select("id, review_date, rating, penalty_amount, review_text, attributed_user_ids")
    .eq("status", "applied")
    .gte("review_date", monthStart)
    .lte("review_date", monthEnd)
    .contains("attributed_user_ids", [userId]);
  const reviewPenaltyEntries = (rpRows || []).map((row: { id: string; review_date: string; rating: number; penalty_amount: number; review_text: string | null }) => ({
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
    attendance: {
      base: attendanceBase,
      earned: attendanceEarned,
      penalties,
      metrics,
      tip: attendanceTip,
    },
    performance: {
      base: isFullTime ? r.performance_allowance_amount : 0,
      earned: performanceEarned,
      score,
      mode: r.performance_allowance_mode,
      eligible: isFullTime,
      breakdown: parts,
      tip: performanceTip,
    },
    reviewPenalty: {
      total: reviewPenaltyTotal,
      entries: reviewPenaltyEntries,
    },
    totalEarned: Math.round(totalEarned * 100) / 100,
    totalMax: isFullTime ? r.attendance_allowance_amount + r.performance_allowance_amount : 0,
  };
}

// Performance score = weighted composite of checklists (team-avg relative), reviews, audit.
// Checklists: user rate vs team-avg for their outlet that month. At/above avg = full marks.
async function computePerformanceScore(
  userId: string,
  year: number,
  month: number,
  r: AllowanceRules,
): Promise<{ score: number; parts: { checklists: number; reviews: number; audit: number } }> {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10);
  const monthStartIso = `${monthStart}T00:00:00Z`;
  const monthEndIso = `${monthEnd}T23:59:59Z`;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, fullName: true, outletId: true } });
  if (!user?.outletId) {
    return { score: 0, parts: { checklists: 0, reviews: 0, audit: 0 } };
  }

  // --- Checklists (team-avg relative, outlet-scoped) ---
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
  // Checklist score: at/above team avg = 100, below = proportional. If no team data → neutral 50.
  let checklistScore: number;
  if (rates.length === 0 || teamAvg === 0) {
    checklistScore = 50;
  } else if (myRate >= teamAvg) {
    checklistScore = 100;
  } else {
    checklistScore = Math.max(0, (myRate / teamAvg) * 100);
  }

  // --- Reviews (outlet GBP avg during month) ---
  let reviewScore = 60; // neutral default if no reviews
  try {
    const rs = await prisma.reviewSettings.findUnique({ where: { outletId: user.outletId }, select: { gbpAccountId: true, gbpLocationName: true } });
    if (rs?.gbpAccountId && rs.gbpLocationName) {
      const data = await fetchGoogleReviews(rs.gbpAccountId, rs.gbpLocationName, 50);
      let sum = 0;
      let count = 0;
      for (const rv of (data.reviews || [])) {
        if (rv.createdAt >= monthStartIso && rv.createdAt <= monthEndIso) {
          sum += rv.rating;
          count++;
        }
      }
      if (count > 0) reviewScore = Math.min(100, (sum / count) * 20); // 5★=100
    }
  } catch { /* ignore */ }

  // --- Audit (named in audit reports, positive/negative mentions) ---
  const auditReports = await prisma.auditReport.findMany({
    where: { completedAt: { gte: new Date(monthStartIso), lte: new Date(monthEndIso) }, status: "COMPLETED" },
    select: { overallScore: true, overallNotes: true, items: { select: { notes: true, rating: true } } },
  });
  let auditPositive = 0;
  let auditNegative = 0;
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
  // Audit score: start at 70 neutral, ±10 per positive/negative, clamped 0-100
  const auditScore = Math.max(0, Math.min(100, 70 + auditPositive * 10 - auditNegative * 20));

  // Weighted composite
  const wSum = r.perf_weight_checklists + r.perf_weight_reviews + r.perf_weight_audit;
  const wC = r.perf_weight_checklists / wSum;
  const wR = r.perf_weight_reviews / wSum;
  const wA = r.perf_weight_audit / wSum;
  const score = Math.round(checklistScore * wC + reviewScore * wR + auditScore * wA);

  return {
    score: Math.max(0, Math.min(100, score)),
    parts: {
      checklists: Math.round(checklistScore),
      reviews: Math.round(reviewScore),
      audit: Math.round(auditScore),
    },
  };
}
