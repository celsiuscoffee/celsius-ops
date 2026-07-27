// Performance Allowance v2 — shared engine (backoffice + staff apps).
//
// Model (FT only — part-time / contract / intern not eligible):
//   ONE performance pool (default RM200) split into 4 EARN levers. Each lever is
//   scored on its OWN KPI (not a uniform %), and pays its slice in 3 steps
//   (nothing / half / full):
//     • Checklist (RM80) = your completion %  → ≥90% full · 70-89% half · <70% none   (all roles)
//     • Phone capture (RM40) = capture rate vs the outlet's target
//           → ≥70% of target full · 50-69% half · <50% none   (FRONT-OF-HOUSE only)
//     • Serving time (RM40) = AVERAGE serve time on your shifts
//           → ≤15 min full · 15-20 min half · >20 min none   (all roles, shift-wide)
//     • Audit (RM40) = your outlet's audit overallScore this month
//           → ≥70% full · 50-69% half · <50% none   (all roles, shift-wide; follows phone tier)
//   A lever that doesn't apply to a person (kitchen never runs the register)
//   drops and its RM REDISTRIBUTES across their applicable levers.
//
//   Then DEDUCT off the earned total (floor RM0, no caps):
//     • Lateness   = flat penalty once past the grace window
//     • Absence    = no-show on a scheduled shift, or > absent-threshold late
//     • Negative reviews = manager-approved hr_review_penalty rows (RM10 each)
import { hrSupabaseAdmin } from "./supabase";
import { prisma } from "@/lib/prisma";
import { computeLateMinutes, mytDateString } from "./hours";
import { getMYTToday } from "./constants";

// Phone capture is a FRONT-OF-HOUSE lever (kitchen does no phone collection).
const FOH_POSITIONS = ["Barista", "Barista Lead", "Supervisor", "Shift Lead", "Manager", "Cashier"];
// An FOH person who barely ran the register also drops phone (not zeroed for it).
const MIN_REGISTER_ORDERS = 20;

export type AllowanceRules = {
  pool: number;
  leverChecklist: number;
  leverPhone: number;
  leverServing: number;
  leverAudit: number;
  checklistFullPct: number;
  checklistHalfPct: number;
  phoneTargetUpliftPp: number;
  phoneDefaultBaselinePct: number;
  phoneFullPct: number; // achievement-vs-target % for full
  phoneHalfPct: number;
  servingFullMinutes: number; // avg serve time <= this → full
  servingHalfMinutes: number;
  latenessGraceMinutes: number;
  latenessPenalty: number;
  latenessAbsentMinutes: number;
  absentPenalty: number;
};

export type AllowanceLeverKey = "checklist" | "phone" | "serving" | "audit";
export type AllowanceTier = "under" | "ok" | "perform";

export type AllowanceLever = {
  key: AllowanceLeverKey;
  label: string;
  applicable: boolean;
  score: number; // a 0-100 display proxy (completion %, achievement %); see `detail` for the real metric
  tier: AllowanceTier;
  slice: number;
  earned: number;
  detail: string;
};

export type AllowanceDeduction = { kind: "late" | "absent" | "review"; label: string; amount: number; date?: string };

export type AllowanceBreakdown = {
  userId: string;
  employmentType: string | null;
  isFullTime: boolean;
  eligible: boolean;
  period: { year: number; month: number; daysElapsed: number; daysRemaining: number };
  pool: number;
  levers: AllowanceLever[];
  performanceEarned: number;
  attendance: { deductions: AllowanceDeduction[]; lateCount: number; absentCount: number; total: number };
  reviewPenalty: { total: number; entries: { id: string; reviewDate: string; rating: number; amount: number; reviewText?: string | null }[] };
  totalEarned: number;
  totalMax: number;
  tip: string;
};

export async function loadAllowanceRules(): Promise<AllowanceRules> {
  const { data } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select(
      "performance_allowance_amount, perf_lever_checklist, perf_lever_phone, perf_lever_serving, perf_lever_audit, checklist_full_pct, checklist_half_pct, perf_tier_perform_pct, perf_tier_ok_pct, phone_capture_target_uplift_pp, phone_capture_default_baseline_pct, serving_full_minutes, serving_half_minutes, attendance_lateness_grace_minutes, attendance_lateness_penalty, attendance_lateness_absent_minutes, attendance_penalty_absent",
    )
    .limit(1)
    .maybeSingle();
  return {
    pool: Number(data?.performance_allowance_amount ?? 200),
    leverChecklist: Number(data?.perf_lever_checklist ?? 80),
    leverPhone: Number(data?.perf_lever_phone ?? 40),
    leverServing: Number(data?.perf_lever_serving ?? 40),
    leverAudit: Number(data?.perf_lever_audit ?? 40),
    checklistFullPct: Number(data?.checklist_full_pct ?? 90),
    checklistHalfPct: Number(data?.checklist_half_pct ?? 70),
    phoneTargetUpliftPp: Number(data?.phone_capture_target_uplift_pp ?? 15),
    phoneDefaultBaselinePct: Number(data?.phone_capture_default_baseline_pct ?? 40),
    phoneFullPct: Number(data?.perf_tier_perform_pct ?? 70),
    phoneHalfPct: Number(data?.perf_tier_ok_pct ?? 50),
    servingFullMinutes: Number(data?.serving_full_minutes ?? 15),
    servingHalfMinutes: Number(data?.serving_half_minutes ?? 20),
    latenessGraceMinutes: Number(data?.attendance_lateness_grace_minutes ?? 10),
    latenessPenalty: Number(data?.attendance_lateness_penalty ?? 10),
    latenessAbsentMinutes: Number(data?.attendance_lateness_absent_minutes ?? 60),
    absentPenalty: Number(data?.attendance_penalty_absent ?? 20),
  };
}

function payoutOf(tier: AllowanceTier, slice: number): number {
  if (tier === "perform") return slice;
  if (tier === "ok") return Math.round((slice / 2) * 100) / 100;
  return 0;
}

const LEVER_LABEL: Record<AllowanceLeverKey, string> = {
  checklist: "Checklist completion",
  phone: "Phone capture",
  serving: "Serving time",
  audit: "Audit score",
};

type RawLever = { tier: AllowanceTier; applicable: boolean; detail: string; score: number };
type AttendanceLog = { clock_in: string; clock_out: string | null; scheduled_start: string | null; scheduled_date: string | null; outlet_id: string | null; excused: boolean | null };

export async function computeAllowancesForUser(
  userId: string,
  year: number,
  month: number,
  rules?: AllowanceRules,
): Promise<AllowanceBreakdown> {
  const r: AllowanceRules = { ...(rules ?? (await loadAllowanceRules())) };

  const mm = String(month).padStart(2, "0");
  const monthStart = `${year}-${mm}-01`;
  const lastDayNum = new Date(Date.UTC(year, month, 0)).getUTCDate(); // days in this month (TZ-independent)
  const monthEnd = `${year}-${mm}-${String(lastDayNum).padStart(2, "0")}`;
  // MYT month window (not UTC) so a shift clocked just after midnight near a month
  // edge is attributed to the right month, and days-elapsed reflects the MYT day.
  const monthStartIso = `${monthStart}T00:00:00+08:00`;
  const monthEndIso = `${monthEnd}T23:59:59+08:00`;
  const todayMyt = getMYTToday();
  const isCurrentMonth = todayMyt.slice(0, 7) === `${year}-${mm}`;
  const daysElapsed = isCurrentMonth ? Math.min(Number(todayMyt.slice(8, 10)), lastDayNum) : lastDayNum;
  const daysRemaining = Math.max(0, lastDayNum - daysElapsed);

  const { data: profile } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("employment_type, schedule_required, position")
    .eq("user_id", userId)
    .maybeSingle();
  const employmentType = profile?.employment_type ?? null;
  const isFullTime = employmentType === "full_time";
  const scheduleRequired = profile?.schedule_required !== false;
  const eligible = isFullTime && scheduleRequired;
  const isFoh = FOH_POSITIONS.includes((profile?.position ?? "").trim());

  const { data: logsRaw } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("clock_in, clock_out, scheduled_start, scheduled_date, outlet_id, excused")
    .eq("user_id", userId)
    .gte("clock_in", monthStartIso)
    .lte("clock_in", monthEndIso);
  const logs = (logsRaw || []) as AttendanceLog[];

  if (!eligible) {
    return {
      userId, employmentType, isFullTime, eligible: false,
      period: { year, month, daysElapsed, daysRemaining },
      pool: r.pool,
      levers: (["checklist", "phone", "serving", "audit"] as AllowanceLeverKey[]).map((k) => ({
        key: k, label: LEVER_LABEL[k], applicable: false, score: 0, tier: "under" as AllowanceTier, slice: 0, earned: 0, detail: "Not eligible",
      })),
      performanceEarned: 0,
      attendance: { deductions: [], lateCount: 0, absentCount: 0, total: 0 },
      reviewPenalty: { total: 0, entries: [] },
      totalEarned: 0, totalMax: 0,
      tip: isFullTime ? "Not applicable — schedule not required for this role." : "Performance allowance is for full-time staff only.",
    };
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { outletId: true } });
  const outletId = user?.outletId ?? null;
  // pos_orders.outlet_id is the loyalty id (e.g. "outlet-con"); HR uses Outlet UUID.
  const outletUuids = Array.from(new Set([outletId, ...logs.map((l) => l.outlet_id)].filter((x): x is string => !!x)));
  const outletRows = outletUuids.length
    ? await prisma.outlet.findMany({ where: { id: { in: outletUuids } }, select: { id: true, loyaltyOutletId: true } })
    : [];
  const loyaltyByUuid = new Map(outletRows.map((o) => [o.id, o.loyaltyOutletId]));
  const myLoyaltyOutlet = outletId ? (loyaltyByUuid.get(outletId) ?? null) : null;

  // Outlet UUIDs the person actually worked (for shift-wide audit attribution).
  const workedOutletUuids = Array.from(new Set(logs.map((l) => l.outlet_id).filter((x): x is string => !!x)));

  // ── EARN: score each lever on its OWN KPI ─────────────────────────────────
  const [rawChecklist, rawPhone, rawServing, rawAudit] = await Promise.all([
    scoreChecklist(userId, outletId, monthStartIso, monthEndIso, r),
    isFoh
      ? scorePhoneCapture(userId, myLoyaltyOutlet, monthStartIso, monthEndIso, r)
      : Promise.resolve<RawLever>({ tier: "under", applicable: false, detail: "not a front-of-house role", score: 0 }),
    scoreServingTime(logs, loyaltyByUuid, monthStartIso, monthEndIso, r),
    scoreAudit(workedOutletUuids, monthStartIso, monthEndIso, r),
  ]);
  const raw: Record<AllowanceLeverKey, RawLever> = { checklist: rawChecklist, phone: rawPhone, serving: rawServing, audit: rawAudit };
  const baseSlice: Record<AllowanceLeverKey, number> = { checklist: r.leverChecklist, phone: r.leverPhone, serving: r.leverServing, audit: r.leverAudit };

  const keys: AllowanceLeverKey[] = ["checklist", "phone", "serving", "audit"];
  const applicableBase = keys.filter((k) => raw[k].applicable).reduce((s, k) => s + baseSlice[k], 0);
  const levers: AllowanceLever[] = keys.map((k) => {
    const applicable = raw[k].applicable && applicableBase > 0;
    const slice = applicable ? Math.round((r.pool * baseSlice[k]) / applicableBase) : 0;
    return {
      key: k, label: LEVER_LABEL[k], applicable, score: raw[k].score, tier: raw[k].tier, slice,
      earned: applicable ? payoutOf(raw[k].tier, slice) : 0,
      detail: applicable ? raw[k].detail : `n/a — ${raw[k].detail} (RM redistributed)`,
    };
  });
  const performanceEarned = Math.round(levers.reduce((s, l) => s + l.earned, 0) * 100) / 100;

  // ── DEDUCT: lateness + absence ────────────────────────────────────────────
  // Only REAL, communicated shifts can no-show: rest-day markers (00:00 rows)
  // are days OFF, pt_suggestion rows were never confirmed, and draft-week
  // shifts were never announced to the person (owner 2026-07-20: rest days
  // were being deducted as "No-show" at RM20 each).
  const { data: scheduled } = await hrSupabaseAdmin
    .from("hr_schedule_shifts").select("shift_date, start_time, notes, hr_schedules!inner(status)").eq("user_id", userId)
    .eq("hr_schedules.status", "published")
    .gte("shift_date", monthStart).lte("shift_date", monthEnd);
  const { data: leaves } = await hrSupabaseAdmin
    .from("hr_leave_requests").select("start_date, end_date").eq("user_id", userId)
    .in("status", ["approved", "ai_approved"]).gte("start_date", monthStart).lte("end_date", monthEnd);
  const leaveDays = new Set<string>();
  (leaves || []).forEach((l: { start_date: string; end_date: string }) => {
    const s = new Date(l.start_date + "T00:00:00Z");
    const e = new Date(l.end_date + "T00:00:00Z");
    for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) leaveDays.add(d.toISOString().slice(0, 10));
  });

  const deductions: AllowanceDeduction[] = [];
  let lateCount = 0, absentCount = 0;
  for (const log of logs) {
    if (log.excused) continue;
    const date = mytDateString(log.clock_in);
    // Lateness against the ROSTER instant (scheduled_date + scheduled_start),
    // cross-midnight safe. No schedule stamped → 0 (no penalty), the safe default.
    const lateMin = computeLateMinutes(log.clock_in, log.scheduled_start, log.scheduled_date ?? date);
    if (lateMin > r.latenessAbsentMinutes) {
      deductions.push({ kind: "absent", label: `Very late (${Math.round(lateMin)}m) — counted as absent`, amount: r.absentPenalty, date });
      absentCount++;
    } else if (lateMin > r.latenessGraceMinutes) {
      deductions.push({ kind: "late", label: `Late ${Math.round(lateMin)}m`, amount: r.latenessPenalty, date });
      lateCount++;
    }
  }
  // A clock-in credits BOTH the calendar day it happened AND the roster day it
  // was FOR (scheduled_date). Without the latter, a punch that lands on a
  // different date than its shift — cross-midnight, a late-night close, or a
  // drifted stamp — leaves the rostered shift looking like a no-show even
  // though the person clearly attended it. (owner 2026-07-21: "invalid date"
  // clock-ins were still showing the shift as missed.)
  const loggedDates = new Set<string>();
  for (const l of logs) {
    loggedDates.add(mytDateString(l.clock_in));
    if (l.scheduled_date) loggedDates.add(l.scheduled_date);
  }
  const missedDates = new Set<string>();
  for (const sh of (scheduled || [])) {
    if (sh.notes === "rest_day" || sh.notes === "pt_suggestion") continue;
    if ((sh.start_time ?? "").startsWith("00:00")) continue;
    if (sh.shift_date >= todayMyt || loggedDates.has(sh.shift_date) || leaveDays.has(sh.shift_date)) continue;
    missedDates.add(sh.shift_date); // dedupe: split shifts = one no-show day
  }
  for (const date of [...missedDates].sort()) {
    deductions.push({ kind: "absent", label: "No-show (scheduled, didn't clock in)", amount: r.absentPenalty, date });
    absentCount++;
  }
  const attendanceTotal = deductions.reduce((s, d) => s + d.amount, 0);

  // ── DEDUCT: manager-approved negative reviews ─────────────────────────────
  const { data: rpRows } = await hrSupabaseAdmin
    .from("hr_review_penalty")
    .select("id, review_date, rating, penalty_amount, review_text")
    .eq("status", "applied").gte("review_date", monthStart).lte("review_date", monthEnd)
    .contains("attributed_user_ids", [userId]);
  const reviewEntries = (rpRows || []).map((row: { id: string; review_date: string; rating: number; penalty_amount: number; review_text: string | null }) => ({
    id: row.id, reviewDate: row.review_date, rating: row.rating, amount: Number(row.penalty_amount), reviewText: row.review_text,
  }));
  const reviewTotal = reviewEntries.reduce((s, e) => s + e.amount, 0);

  const totalEarned = Math.max(0, performanceEarned - attendanceTotal - reviewTotal);

  return {
    userId, employmentType, isFullTime, eligible: true,
    period: { year, month, daysElapsed, daysRemaining },
    pool: r.pool, levers, performanceEarned,
    attendance: { deductions, lateCount, absentCount, total: attendanceTotal },
    reviewPenalty: { total: reviewTotal, entries: reviewEntries },
    totalEarned: Math.round(totalEarned * 100) / 100,
    totalMax: r.pool,
    tip: buildTip(levers, lateCount, absentCount, reviewTotal, daysRemaining),
  };
}

function buildTip(levers: AllowanceLever[], lateCount: number, absentCount: number, reviewTotal: number, daysRemaining: number): string {
  if (absentCount > 0) return `You've missed ${absentCount} scheduled shift${absentCount > 1 ? "s" : ""} — each costs your allowance. Attend all remaining shifts.`;
  const weakest = levers.filter((l) => l.applicable && l.tier !== "perform")[0];
  if (weakest) return `Push your ${weakest.label.toLowerCase()} (${weakest.detail}) to the full mark to unlock RM${weakest.slice}.`;
  if (lateCount > 0) return `Be on time for the next ${Math.min(3, daysRemaining)} clock-ins to protect your allowance.`;
  if (reviewTotal > 0) return "A negative review was deducted this month — keep service quality high.";
  return "All levers at full — full allowance on track. Keep it up!";
}

// ── Lever scorers (each applies its OWN KPI to decide the tier) ───────────────

// Checklist: your completion %. ≥ full% → full · ≥ half% → half · else none.
async function scoreChecklist(userId: string, outletId: string | null, monthStartIso: string, monthEndIso: string, r: AllowanceRules): Promise<RawLever> {
  const rows = await prisma.checklist.findMany({
    where: { assignedToId: userId, createdAt: { gte: new Date(monthStartIso), lte: new Date(monthEndIso) }, ...(outletId ? { outletId } : {}) },
    select: { status: true },
  });
  if (rows.length === 0) return { tier: "under", applicable: false, detail: "no checklists assigned", score: 0 };
  const done = rows.filter((c) => c.status === "COMPLETED").length;
  const pct = Math.round((done / rows.length) * 100);
  const tier: AllowanceTier = pct >= r.checklistFullPct ? "perform" : pct >= r.checklistHalfPct ? "ok" : "under";
  return { tier, applicable: true, detail: `${done}/${rows.length} done (${pct}%)`, score: pct };
}

// Phone capture: capture rate vs the outlet target (trailing-90d baseline + uplift).
// Achievement = capture/target. ≥ full% → full · ≥ half% → half · else none.
async function scorePhoneCapture(userId: string, loyaltyOutletId: string | null, monthStartIso: string, monthEndIso: string, r: AllowanceRules): Promise<RawLever> {
  const { data: mine } = await hrSupabaseAdmin
    .from("pos_orders").select("customer_phone, loyalty_phone").eq("employee_id", userId)
    .gte("created_at", monthStartIso).lte("created_at", monthEndIso);
  const total = (mine || []).length;
  if (total < MIN_REGISTER_ORDERS) return { tier: "under", applicable: false, detail: `not a register operator (${total} orders)`, score: 0 };
  const captured = (mine || []).filter((o: { customer_phone: string | null; loyalty_phone: string | null }) => o.customer_phone || o.loyalty_phone).length;
  const myRate = (captured / total) * 100;

  let baseline = r.phoneDefaultBaselinePct;
  if (loyaltyOutletId) {
    const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const { data: outletRows } = await hrSupabaseAdmin
      .from("pos_orders").select("customer_phone, loyalty_phone").eq("outlet_id", loyaltyOutletId).gte("created_at", since);
    const oTotal = (outletRows || []).length;
    if (oTotal >= 50) {
      const oCap = (outletRows || []).filter((o: { customer_phone: string | null; loyalty_phone: string | null }) => o.customer_phone || o.loyalty_phone).length;
      baseline = (oCap / oTotal) * 100;
    }
  }
  const target = Math.min(95, baseline + r.phoneTargetUpliftPp);
  const achievement = Math.min(100, Math.round((myRate / target) * 100));
  const tier: AllowanceTier = achievement >= r.phoneFullPct ? "perform" : achievement >= r.phoneHalfPct ? "ok" : "under";
  return { tier, applicable: true, detail: `${Math.round(myRate)}% vs ${Math.round(target)}% target`, score: achievement };
}

// Serving time (shift-wide): AVERAGE serve time (served_at - created_at) over the
// orders at your outlet(s) during the shifts you worked.
// avg ≤ full-min → full · ≤ half-min → half · else none.
async function scoreServingTime(logs: AttendanceLog[], loyaltyByUuid: Map<string, string | null>, monthStartIso: string, monthEndIso: string, r: AllowanceRules): Promise<RawLever> {
  const windows = logs
    .filter((l) => l.outlet_id && l.clock_in && loyaltyByUuid.get(l.outlet_id))
    .map((l) => ({ outlet: loyaltyByUuid.get(l.outlet_id as string) as string, start: new Date(l.clock_in).getTime(), end: new Date(l.clock_out ?? new Date().toISOString()).getTime() }))
    .filter((w) => w.end >= w.start);
  if (windows.length === 0) return { tier: "under", applicable: false, detail: "no shifts worked", score: 0 };

  const outlets = Array.from(new Set(windows.map((w) => w.outlet)));
  const { data: orders } = await hrSupabaseAdmin
    .from("pos_orders").select("created_at, served_at, outlet_id")
    .in("outlet_id", outlets).not("served_at", "is", null)
    .gte("created_at", monthStartIso).lte("created_at", monthEndIso);

  let total = 0, sumMs = 0;
  for (const o of (orders || []) as { created_at: string; served_at: string; outlet_id: string }[]) {
    const servedMs = new Date(o.served_at).getTime();
    const createdMs = new Date(o.created_at).getTime();
    if (servedMs < createdMs) continue;
    if (!windows.some((w) => w.outlet === o.outlet_id && servedMs >= w.start && servedMs <= w.end)) continue;
    total++;
    sumMs += servedMs - createdMs;
  }
  if (total === 0) return { tier: "under", applicable: false, detail: "no served orders on your shifts", score: 0 };
  const avgMin = (sumMs / total) / 60000;
  const tier: AllowanceTier = avgMin <= r.servingFullMinutes ? "perform" : avgMin <= r.servingHalfMinutes ? "ok" : "under";
  // display proxy: 100 at/under full, scaling down past it (for the UI bar only)
  const score = Math.max(0, Math.min(100, Math.round((r.servingFullMinutes / avgMin) * 100)));
  return { tier, applicable: true, detail: `avg ${avgMin.toFixed(1)}min over ${total} orders`, score };
}

// Audit (shift-wide): the average completed-audit overallScore for the outlet(s)
// you worked this month. Scored on the same tier as phone capture (>=70% full,
// >=50% half). AuditReport.outletId is the Outlet UUID (same space as HR).
async function scoreAudit(workedOutletUuids: string[], monthStartIso: string, monthEndIso: string, r: AllowanceRules): Promise<RawLever> {
  if (workedOutletUuids.length === 0) return { tier: "under", applicable: false, detail: "no shifts worked", score: 0 };
  const reports = await prisma.auditReport.findMany({
    where: {
      outletId: { in: workedOutletUuids },
      status: "COMPLETED",
      overallScore: { not: null },
      completedAt: { gte: new Date(monthStartIso), lte: new Date(monthEndIso) },
    },
    select: { overallScore: true },
  });
  if (reports.length === 0) return { tier: "under", applicable: false, detail: "no audits at your outlet this month", score: 0 };
  const avg = Math.round(reports.reduce((s, a) => s + Number(a.overallScore), 0) / reports.length);
  // Follows phone capture's tier (perf/ok thresholds).
  const tier: AllowanceTier = avg >= r.phoneFullPct ? "perform" : avg >= r.phoneHalfPct ? "ok" : "under";
  return { tier, applicable: true, detail: `${reports.length} audit${reports.length > 1 ? "s" : ""} avg ${avg}%`, score: avg };
}
