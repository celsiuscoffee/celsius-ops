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
import { probationReviewDue, isOnProbation } from "./probation";
import { fetchAllRows } from "./fetch-all";

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
  /** Fixed target for every outlet. When set, baseline + uplift is not used. */
  phoneTargetPct: number | null;
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
  /** What the engine scored, before any hand edit. Equals `earned` when unedited. */
  originalEarned: number;
  edited: boolean;
  editReason: string | null;
};

export type AllowanceDeduction = {
  kind: "late" | "absent" | "review";
  label: string;
  amount: number;
  date?: string;
  /**
   * Stable identity for this line, so an edit survives a recompute. Keyed on
   * the source row's id — NOT its position in the list, which moves. See the
   * hr_performance_line_overrides migration for the formats.
   */
  key: string;
  /** What the engine computed, before any edit. Equals `amount` when unedited. */
  originalAmount: number;
  edited: boolean;
  editReason: string | null;
};

/** A row from hr_performance_line_overrides, reduced to what the engine needs. */
export type LineOverride = { amount: number; reason: string };

/** Applied result shared by levers and deductions. */
type Edited<T> = T & { originalAmount: number; edited: boolean; editReason: string | null };

/**
 * Replace one line's figure with a hand-entered one, clamped to [0, max].
 *
 * `amount` on the stored row is what to pay (a lever) or charge (a deduction)
 * INSTEAD of the computed figure — never a delta. The clamp is what keeps this
 * delegable: `max` is the computed charge for a deduction, so an edit can only
 * give back money the engine took; and the pool for a lever, so no single edit
 * can inflate a month past the allowance itself.
 *
 * A stored amount that isn't a usable number leaves the computed figure alone.
 * Silently paying — or charging — something arbitrary is the worse failure.
 *
 * Pure, so the clamp is testable without a database.
 */
export function applyLineOverride<T extends { key: string; amount: number }>(
  line: T,
  overrides: Map<string, LineOverride>,
  max: number,
): Edited<T> {
  const o = overrides.get(line.key);
  if (!o) return { ...line, originalAmount: line.amount, edited: false, editReason: null };
  const raw = Number(o.amount);
  const applied = Number.isFinite(raw) ? Math.max(0, Math.min(max, raw)) : line.amount;
  return {
    ...line,
    amount: Math.round(applied * 100) / 100,
    originalAmount: line.amount,
    edited: true,
    editReason: o.reason,
  };
}

export type AllowanceBreakdown = {
  userId: string;
  employmentType: string | null;
  isFullTime: boolean;
  eligible: boolean;
  /** Scored as normal, but payroll pays nothing while this is true. */
  onProbation: boolean;
  probationEndDate: string | null;
  period: { year: number; month: number; daysElapsed: number; daysRemaining: number };
  pool: number;
  levers: AllowanceLever[];
  performanceEarned: number;
  attendance: { deductions: AllowanceDeduction[]; lateCount: number; absentCount: number; total: number };
  reviewPenalty: {
    total: number;
    entries: {
      id: string; reviewDate: string; rating: number; amount: number; reviewText?: string | null;
      key: string; originalAmount: number; edited: boolean; editReason: string | null;
    }[];
  };
  totalEarned: number;
  totalMax: number;
  tip: string;
};

export async function loadAllowanceRules(): Promise<AllowanceRules> {
  const { data } = await hrSupabaseAdmin
    .from("hr_company_settings")
    .select(
      "performance_allowance_amount, perf_lever_checklist, perf_lever_phone, perf_lever_serving, perf_lever_audit, checklist_full_pct, checklist_half_pct, perf_tier_perform_pct, perf_tier_ok_pct, phone_capture_target_pct, phone_capture_target_uplift_pp, phone_capture_default_baseline_pct, serving_full_minutes, serving_half_minutes, attendance_lateness_grace_minutes, attendance_lateness_penalty, attendance_lateness_absent_minutes, attendance_penalty_absent",
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
    phoneTargetPct: data?.phone_capture_target_pct != null && Number.isFinite(Number(data.phone_capture_target_pct))
      ? Number(data.phone_capture_target_pct)
      : null,
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
type AttendanceLog = { id: string; clock_in: string; clock_out: string | null; scheduled_start: string | null; scheduled_date: string | null; outlet_id: string | null; excused: boolean | null };

/**
 * Read `hr_employee_profiles.fixed_performance_allowance`. Returns null when the
 * employee is on the normal scored pool — which is NULL, a blank, or any value
 * that isn't a usable non-negative number. A junk value must fall back to
 * scoring rather than silently paying something arbitrary.
 */
export function parseFixedAllowance(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A performance allowance paid FLAT: the full amount, every month, with the
 * levers marked not-applicable and no attendance or review deductions. Used for
 * roles the lever engine cannot score (see the fixed_performance_allowance
 * migration). Pure, so the payout is testable without a database.
 */
export function buildFixedAllowanceBreakdown(o: {
  userId: string;
  employmentType: string | null;
  isFullTime: boolean;
  amount: number;
  period: { year: number; month: number; daysElapsed: number; daysRemaining: number };
}): AllowanceBreakdown {
  const detail = "n/a — fixed allowance, not scored";
  const tip = `Fixed allowance of RM${o.amount.toFixed(2)} — not scored against the performance levers.`;

  return {
    userId: o.userId,
    employmentType: o.employmentType,
    isFullTime: o.isFullTime,
    eligible: true,
    onProbation: false,
    probationEndDate: null,
    period: o.period,
    pool: o.amount,
    levers: (["checklist", "phone", "serving", "audit"] as AllowanceLeverKey[]).map((k) => ({
      key: k, label: LEVER_LABEL[k], applicable: false, score: 0, tier: "under" as AllowanceTier,
      slice: 0, earned: 0, detail, originalEarned: 0, edited: false, editReason: null,
    })),
    performanceEarned: o.amount,
    // A flat allowance is flat: no lever scoring, and no attendance or review
    // deductions taken off it.
    attendance: { deductions: [], lateCount: 0, absentCount: 0, total: 0 },
    reviewPenalty: { total: 0, entries: [] },
    totalEarned: o.amount,
    totalMax: o.amount,
    tip,
  };
}

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
    .select("employment_type, schedule_required, position, fixed_performance_allowance, probation_end_date, join_date, confirmed_at")
    .eq("user_id", userId)
    .maybeSingle();
  const employmentType = profile?.employment_type ?? null;
  const isFullTime = employmentType === "full_time";
  const scheduleRequired = profile?.schedule_required !== false;
  // Probation: still SCORED, just not PAID (owner 2026-08-03: "for probation
  // staff, they are not entitled to allowances (we still need the performance).
  // gate this on payroll?"). So the gate lives in payroll-calculator, not here —
  // zeroing eligibility here would blank the levers too, and the whole point is
  // to keep watching how a new joiner is doing while paying them nothing.
  //
  // Probation ends on CONFIRMATION, never on elapsed time (owner 2026-08-03:
  // "probation will end only after confirmation. it is not time base"). So the
  // gate reads `confirmed_at` and nothing else. `probationEnd` below is the date
  // the review is DUE — carried for display only, it decides nothing.
  const onProbation = isOnProbation(monthEnd, profile?.confirmed_at as string | null);
  const probationEnd = probationReviewDue(
    profile?.join_date as string | null,
    profile?.probation_end_date as string | null,
  );
  const eligible = isFullTime && scheduleRequired;
  const isFoh = FOH_POSITIONS.includes((profile?.position ?? "").trim());

  // FLAT allowance — checked before everything else, including the eligibility
  // gate. Some roles cannot be scored by these levers at all: a Head of
  // Department has no roster (schedule_required = false), no checklists and no
  // register orders, so the engine would force RM0 no matter what is configured.
  // Their scheme is a different one (COGS, people cost) that does not exist yet,
  // so the amount is paid flat until it does.
  //
  // Flat means flat: no lever scoring, no lateness/absence deductions, no review
  // penalties. Proration for a partial month still applies downstream in
  // payroll-calculator.ts, same as a scored allowance.
  // There is no whole-month replace any more (owner 2026-08-03: "remove the
  // replace the whole month"). Corrections are made line by line further down,
  // where the reason attaches to the thing that was actually wrong.
  //
  // A flat all-months amount, for unrostered roles the levers can't score.
  const fixedAllowance = parseFixedAllowance(profile?.fixed_performance_allowance);
  if (fixedAllowance != null) {
    return buildFixedAllowanceBreakdown({
      userId, employmentType, isFullTime, amount: fixedAllowance,
      period: { year, month, daysElapsed, daysRemaining },
    });
  }

  const { data: logsRaw } = await hrSupabaseAdmin
    .from("hr_attendance_logs")
    .select("id, clock_in, clock_out, scheduled_start, scheduled_date, outlet_id, excused")
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
        key: k, label: LEVER_LABEL[k], applicable: false, score: 0, tier: "under" as AllowanceTier, slice: 0, earned: 0,
        detail: "Not eligible", originalEarned: 0, edited: false, editReason: null,
      })),
      performanceEarned: 0,
      attendance: { deductions: [], lateCount: 0, absentCount: 0, total: 0 },
      reviewPenalty: { total: 0, entries: [] },
      totalEarned: 0, totalMax: 0,
      onProbation, probationEndDate: probationEnd,
      tip: isFullTime
        ? "Not applicable — schedule not required for this role."
        : "Performance allowance is for full-time staff only.",
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

  // Hand edits for THIS month, for any line — a lever the engine couldn't score
  // fairly, or a deduction that shouldn't stand (an absence that was approved
  // leave, a review the person wasn't on shift for). Fetched once and applied
  // to both halves below; see applyLineOverride for the clamps.
  const { data: overrideRows } = await hrSupabaseAdmin
    .from("hr_performance_line_overrides")
    .select("line_key, amount, reason")
    .eq("user_id", userId)
    .eq("period_year", year)
    .eq("period_month", month);
  const overrides = new Map<string, LineOverride>(
    ((overrideRows || []) as { line_key: string; amount: unknown; reason: string | null }[]).map((o) => [
      o.line_key,
      { amount: Number(o.amount), reason: String(o.reason ?? "") },
    ]),
  );

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
    const scored = {
      key: k, label: LEVER_LABEL[k], applicable, score: raw[k].score, tier: raw[k].tier, slice,
      // applyLineOverride keys on `amount`; the lever's public field is `earned`.
      amount: applicable ? payoutOf(raw[k].tier, slice) : 0,
      detail: applicable ? raw[k].detail : `n/a — ${raw[k].detail} (RM redistributed)`,
    };
    // A lever edit is clamped to the POOL, not to the lever's own slice: a lever
    // that scored n/a has a slice of 0, and refusing to pay it would make the
    // one case this exists for — "the engine couldn't score this, pay it by
    // hand" — impossible. The pool still bounds any single month.
    const { amount, originalAmount, edited, editReason } = applyLineOverride({ ...scored, key: `lever|${k}` }, overrides, r.pool);
    return {
      ...scored, earned: amount, originalEarned: originalAmount, edited, editReason,
      detail: edited ? `set by hand — ${editReason ?? ""}`.trim() : scored.detail,
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
  for (const log of logs) {
    if (log.excused) continue;
    const date = mytDateString(log.clock_in);
    // Lateness against the ROSTER instant (scheduled_date + scheduled_start),
    // cross-midnight safe. No schedule stamped → 0 (no penalty), the safe default.
    const lateMin = computeLateMinutes(log.clock_in, log.scheduled_start, log.scheduled_date ?? date);
    if (lateMin > r.latenessAbsentMinutes) {
      deductions.push(applyLineOverride(
        { kind: "absent" as const, label: `Very late (${Math.round(lateMin)}m) — counted as absent`, amount: r.absentPenalty, date, key: `absent|${log.id}` },
        overrides, r.absentPenalty,
      ));
    } else if (lateMin > r.latenessGraceMinutes) {
      deductions.push(applyLineOverride(
        { kind: "late" as const, label: `Late ${Math.round(lateMin)}m`, amount: r.latenessPenalty, date, key: `late|${log.id}` },
        overrides, r.latenessPenalty,
      ));
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
    deductions.push(applyLineOverride(
      { kind: "absent" as const, label: "No-show (scheduled, didn't clock in)", amount: r.absentPenalty, date, key: `noshow|${date}` },
      overrides, r.absentPenalty,
    ));
  }
  // Counts drive the coaching tip and the summary column, so they follow the
  // money: a line edited down to zero is not held against the person. A partial
  // reduction still counts — the incident happened, it just cost less.
  const lateCount = deductions.filter((d) => d.kind === "late" && d.amount > 0).length;
  const absentCount = deductions.filter((d) => d.kind === "absent" && d.amount > 0).length;
  const attendanceTotal = Math.round(deductions.reduce((s, d) => s + d.amount, 0) * 100) / 100;

  // ── DEDUCT: manager-approved negative reviews ─────────────────────────────
  const { data: rpRows } = await hrSupabaseAdmin
    .from("hr_review_penalty")
    .select("id, review_date, rating, penalty_amount, review_text")
    .eq("status", "applied").gte("review_date", monthStart).lte("review_date", monthEnd)
    .contains("attributed_user_ids", [userId]);
  const reviewEntries = (rpRows || []).map((row: { id: string; review_date: string; rating: number; penalty_amount: number; review_text: string | null }) => {
    const applied = applyLineOverride(
      { kind: "review" as const, label: `${row.rating}★ review ${row.review_date}`, amount: Number(row.penalty_amount), date: row.review_date, key: `review|${row.id}` },
      overrides, Number(row.penalty_amount),
    );
    return {
      id: row.id, reviewDate: row.review_date, rating: row.rating, reviewText: row.review_text,
      amount: applied.amount, key: applied.key,
      originalAmount: applied.originalAmount, edited: applied.edited, editReason: applied.editReason,
    };
  });
  const reviewTotal = Math.round(reviewEntries.reduce((s, e) => s + e.amount, 0) * 100) / 100;

  const totalEarned = Math.max(0, performanceEarned - attendanceTotal - reviewTotal);

  return {
    userId, employmentType, isFullTime, eligible: true,
    onProbation, probationEndDate: probationEnd,
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
  // Paged: the busiest July operator rang 778 orders, under the 1000 cap today,
  // but a busier month or a two-month window would silently truncate and
  // understate their capture rate. See fetchAllRows.
  const mine = await fetchAllRows<{ customer_phone: string | null; loyalty_phone: string | null }>(() =>
    hrSupabaseAdmin
      .from("pos_orders").select("customer_phone, loyalty_phone").eq("employee_id", userId)
      .gte("created_at", monthStartIso).lte("created_at", monthEndIso),
  );
  const total = mine.length;
  if (total < MIN_REGISTER_ORDERS) return { tier: "under", applicable: false, detail: `not a register operator (${total} orders)`, score: 0 };
  const captured = mine.filter((o) => o.customer_phone || o.loyalty_phone).length;
  const myRate = (captured / total) * 100;

  // ONE fixed target for every outlet (owner 2026-08-03: "put phone target 70%
  // for all"). This replaced a per-outlet target of "your own trailing-90-day
  // capture rate + 15pp", which was wrong twice over:
  //
  //   1. A self-referential target rewards a low starting point — the worst
  //      outlet got the easiest bar, and improving raised your own bar.
  //   2. The baseline read below had NO .range(), and PostgREST caps a response
  //      at 1000 rows. Every outlet is far past that (5,601 / 4,457 / 4,192
  //      orders per 90 days), so the baseline was computed from the OLDEST 1000
  //      orders and every target came out too low. Tamarind's showed 35% where
  //      the true figure was 44%, which is what surfaced this.
  //
  // The per-outlet path is kept and NULL restores it. The truncation is FIXED
  // now (it pages via fetchAllRows), so turning it back on is safe on that
  // count — reason 1 is the reason it stays off.
  let target: number;
  if (r.phoneTargetPct != null) {
    target = r.phoneTargetPct;
  } else {
    let baseline = r.phoneDefaultBaselinePct;
    if (loyaltyOutletId) {
      const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
      const outletRows = await fetchAllRows<{ customer_phone: string | null; loyalty_phone: string | null }>(() =>
        hrSupabaseAdmin
          .from("pos_orders").select("customer_phone, loyalty_phone").eq("outlet_id", loyaltyOutletId).gte("created_at", since),
      );
      const oTotal = outletRows.length;
      if (oTotal >= 50) {
        const oCap = outletRows.filter((o) => o.customer_phone || o.loyalty_phone).length;
        baseline = (oCap / oTotal) * 100;
      }
    }
    target = Math.min(95, baseline + r.phoneTargetUpliftPp);
  }
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
  // THE ONE THAT WAS ACTUALLY BITING. This spans whole outlets for a whole
  // month — 7,626 served orders in July 2026 — so the old unbounded read saw
  // the first 1000 and scored everybody's serving time off roughly 1–4 July.
  // Worth RM40–50 a head per month.
  const orders = await fetchAllRows<{ created_at: string; served_at: string; outlet_id: string }>(() =>
    hrSupabaseAdmin
      .from("pos_orders").select("created_at, served_at, outlet_id")
      .in("outlet_id", outlets).not("served_at", "is", null)
      .gte("created_at", monthStartIso).lte("created_at", monthEndIso),
  );

  let total = 0, sumMs = 0;
  for (const o of orders) {
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
