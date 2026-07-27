// Part-timer PERFORMANCE signal for AI Fill suggestions.
//
// The scheduler already spreads PT work by FAIRNESS (trailing rostered hours) and
// COST (hourly rate). This adds a reliability lever so that, between two similarly
// under-worked part-timers, the one who actually shows up on time and finishes
// their checklists is preferred — the manager still confirms every suggestion.
//
// Two grounded signals over a trailing window (default 60 days), each Bayesian-
// shrunk so a thin history isn't over-trusted:
//   • on-time rate  — from hr_attendance_logs (clock-in vs scheduled start, the
//                     same lateness math the roster view uses).
//   • checklist rate — from Checklist (COMPLETED ÷ assigned), the shift SOPs the
//                     checklist-linker assigns to whoever is rostered.
// Blended into a single 0..1 score. Reused shape from the candidates route's
// reliabilityOf() (PRIOR 0.7 / K 3) so the two stay consistent.

import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "./supabase";
import { computeLateMinutes, mytDateString } from "./hours";
import { GRACE_PERIOD_MINUTES } from "./constants";

// Bayesian shrink priors: a staffer with no history sits at the prior, and each
// real observation pulls the estimate toward their actual rate.
const REL_PRIOR = 0.7, REL_K = 3; // on-time — matches candidates route
const CHK_PRIOR = 0.8, CHK_K = 3; // checklist completion
// Blend weights for the composite score (attendance weighted a touch heavier —
// a no-show/late costs coverage directly; an unfinished checklist is softer).
const W_ONTIME = 0.6, W_CHECKLIST = 0.4;

export type PtPerformance = {
  onTimeRate: number; // 0..1, Bayesian-shrunk on-time rate
  checklistRate: number; // 0..1, Bayesian-shrunk checklist-completion rate
  score: number; // 0..1 blended
  attendanceSample: number; // # clock-outs observed in window (0 ⇒ score is the prior)
  checklistSample: number; // # checklists assigned in window
};

// Compute per-user performance for the given users over [referenceDate − windowDays,
// referenceDate). Users with no history get the neutral prior score. Never throws
// on a query error — returns the prior for everyone so generation still proceeds.
export async function computePtPerformance(
  userIds: string[],
  referenceDate: string, // YYYY-MM-DD (the week being generated)
  windowDays = 60,
): Promise<Map<string, PtPerformance>> {
  const out = new Map<string, PtPerformance>();
  const priorScore = W_ONTIME * REL_PRIOR + W_CHECKLIST * CHK_PRIOR;
  const priorRow: PtPerformance = {
    onTimeRate: REL_PRIOR,
    checklistRate: CHK_PRIOR,
    score: priorScore,
    attendanceSample: 0,
    checklistSample: 0,
  };
  if (userIds.length === 0) return out;
  for (const uid of userIds) out.set(uid, { ...priorRow });

  const refMs = Date.parse(referenceDate + "T00:00:00Z");
  if (Number.isNaN(refMs)) return out;
  const sinceIso = new Date(refMs - windowDays * 86400000).toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  try {
    // On-time rate — completed logs (clock-out present) with a scheduled start.
    const { data: att } = await hrSupabaseAdmin
      .from("hr_attendance_logs")
      .select("user_id, clock_in, scheduled_start, scheduled_date")
      .in("user_id", userIds)
      .gte("clock_in", sinceIso)
      .not("clock_out", "is", null)
      .not("scheduled_start", "is", null);
    const rel = new Map<string, { onTime: number; total: number }>();
    for (const a of (att ?? []) as Array<{ user_id: string; clock_in: string; scheduled_start: string | null; scheduled_date: string | null }>) {
      const late = computeLateMinutes(a.clock_in, a.scheduled_start, a.scheduled_date ?? mytDateString(a.clock_in));
      const g = rel.get(a.user_id) ?? { onTime: 0, total: 0 };
      g.total += 1;
      if (late <= GRACE_PERIOD_MINUTES) g.onTime += 1;
      rel.set(a.user_id, g);
    }

    // Checklist completion — SOP checklists assigned to the staffer in the window.
    const checklists = await prisma.checklist.findMany({
      where: { assignedToId: { in: userIds }, date: { gte: new Date(sinceDate + "T00:00:00Z") } },
      select: { assignedToId: true, status: true },
    });
    const chk = new Map<string, { done: number; total: number }>();
    for (const c of checklists) {
      if (!c.assignedToId) continue;
      const g = chk.get(c.assignedToId) ?? { done: 0, total: 0 };
      g.total += 1;
      if (c.status === "COMPLETED") g.done += 1;
      chk.set(c.assignedToId, g);
    }

    for (const uid of userIds) {
      const r = rel.get(uid);
      const c = chk.get(uid);
      const onTimeRate = r ? (r.onTime + REL_PRIOR * REL_K) / (r.total + REL_K) : REL_PRIOR;
      const checklistRate = c ? (c.done + CHK_PRIOR * CHK_K) / (c.total + CHK_K) : CHK_PRIOR;
      out.set(uid, {
        onTimeRate,
        checklistRate,
        score: W_ONTIME * onTimeRate + W_CHECKLIST * checklistRate,
        attendanceSample: r?.total ?? 0,
        checklistSample: c?.total ?? 0,
      });
    }
  } catch {
    // Leave everyone on the prior — performance is a nudge, never a hard gate.
  }
  return out;
}
