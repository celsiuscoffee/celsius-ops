// Grant-time loop engineering — the SMS loop engine's holdout + arms +
// attribution applied to rewards the app HANDS OUT (mission completions,
// mystery drops, milestones), where there is no message to send and no one
// can be held out of a promised reward.
//
// Model (shares the SMS engine's tables + measurement wholesale):
//   • A rolling `loop_rounds` row (status 'open') accumulates assignments for
//     `roundDays`, then closes to 'sent' — from there the backoffice engine's
//     autoMeasureDueRounds → measureRound machinery measures it unchanged.
//   • The CONTROL arm is stored under the engine's 'holdout' key, but it is
//     not "no reward" — it receives the mechanic's status-quo reward (e.g.
//     the mission's own configured voucher). Lift therefore reads "treatment
//     reward vs the reward we hand out today", which is the honest baseline
//     for a grant: withholding the earned reward would break the promise.
//   • Treatment arms swap in their own voucher_template_id. Attribution keys
//     off loop_assignments.issued_reward_id + orders-by-phone, exactly like
//     the SMS loops (see apps/backoffice/src/lib/loyalty/loop-engine.ts).
//
// Every entry point here FAILS OPEN: if anything errors (no phone, race,
// settings typo), the caller gets the status-quo reward and no assignment is
// logged. Experiment plumbing must never break reward fulfilment.

import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_BRAND_ID = "brand-celsius";

export type GrantArm = {
  key: string;
  label: string;
  voucher_template_id: string;
};

export type GrantLoopDef = {
  /** loop_rounds.loop_key — also needs a LOOPS entry in the backoffice
   *  engine so dashboards label it and the cron closes/measures rounds. */
  loopKey: string;
  /** How long one round accumulates assignments before it closes. */
  roundDays: number;
  /** Attribution window measured after the round closes. */
  windowDays: number;
  /** % of members kept on the status-quo reward (the control arm). */
  controlPct: number;
  /** app_settings key holding a JSON GrantArm[] override — lets the owner
   *  swap challengers without a deploy. Falls back to defaultArms. */
  settingsKey?: string;
  defaultArms: GrantArm[];
};

/** Mission-completion reward experiment: control keeps the mission's own
 *  configured voucher(s); the challenger swaps in Free Coffee (the same
 *  low-COGS, visit-driving lure the birthday loop uses). 50/50 split so the
 *  control baseline accrues as fast as the treatment evidence. */
export const MISSION_REWARD_LOOP: GrantLoopDef = {
  loopKey: "mission_reward",
  roundDays: 7,
  windowDays: 14,
  controlPct: 50,
  settingsKey: "mission_reward_loop_arms",
  defaultArms: [
    { key: "free_coffee", label: "Free Coffee", voucher_template_id: "206b5fbf-c12a-44e5-ad30-85a9e8a81439" },
  ],
};

/** Pure arm pick — rand ∈ [0,1). Below controlPct → control ('holdout' in
 *  engine terms); the remainder splits uniformly across the arms. */
export function pickGrantArm(controlPct: number, arms: GrantArm[], rand: number): GrantArm | "control" {
  const c = Math.min(100, Math.max(0, controlPct)) / 100;
  if (arms.length === 0 || rand < c) return "control";
  const span = 1 - c;
  const idx = span > 0 ? Math.floor(((rand - c) / span) * arms.length) : 0;
  return arms[Math.min(idx, arms.length - 1)];
}

function rid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function resolveArms(supabase: SupabaseClient, loop: GrantLoopDef): Promise<GrantArm[]> {
  if (loop.settingsKey) {
    try {
      const { data } = await supabase
        .from("app_settings").select("value").eq("key", loop.settingsKey).maybeSingle();
      if (data?.value) {
        const parsed: unknown = JSON.parse(String(data.value));
        if (Array.isArray(parsed)) {
          const arms = parsed
            .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
            .filter((a) => typeof a.key === "string" && typeof a.voucher_template_id === "string")
            .map((a) => ({ key: String(a.key), label: String(a.label ?? a.key), voucher_template_id: String(a.voucher_template_id) }));
          if (arms.length) return arms;
        }
      }
    } catch { /* malformed override → code defaults */ }
  }
  return loop.defaultArms;
}

type OpenRound = { id: string; arms: GrantArm[] };

/** Find the loop's current open round, closing an expired one and starting
 *  the next as needed. Arms are frozen onto the round at creation so a
 *  settings change mid-round can't skew a round's split. */
async function currentOpenRound(supabase: SupabaseClient, loop: GrantLoopDef, brandId: string): Promise<OpenRound> {
  const { data: open } = await supabase
    .from("loop_rounds")
    .select("id, prepared_at, arms")
    .eq("loop_key", loop.loopKey)
    .eq("status", "open")
    .order("prepared_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open) {
    const expiresMs = new Date(open.prepared_at as string).getTime() + loop.roundDays * 86400000;
    if (Date.now() < expiresMs) {
      return { id: open.id as string, arms: (open.arms ?? []) as GrantArm[] };
    }
    // Round's open window elapsed — close it ('sent' hands it to the existing
    // autoMeasureDueRounds → measureRound flow). Status-guarded so a
    // concurrent closer or the backoffice cron can't double-close.
    await supabase
      .from("loop_rounds")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", open.id).eq("status", "open");
  }

  const arms = await resolveArms(supabase, loop);
  const { data: last } = await supabase
    .from("loop_rounds")
    .select("round_no")
    .eq("loop_key", loop.loopKey)
    .order("round_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  const roundId = rid("lr");
  const { error } = await supabase.from("loop_rounds").insert({
    id: roundId,
    brand_id: brandId,
    loop_key: loop.loopKey,
    round_no: ((last?.round_no as number) ?? 0) + 1,
    segment_label: `Grant-time (rolling ${loop.roundDays}d, ${loop.controlPct}% control)`,
    holdout_pct: loop.controlPct,
    // message is unused (nothing is sent) but kept for shape-compatibility
    // with the SMS rounds the dashboards render.
    arms: arms.map((a) => ({ ...a, message: "" })),
    attribution_window_days: loop.windowDays,
    status: "open",
    meta: { kind: "grant", round_days: loop.roundDays },
    created_by: `grant:${loop.loopKey}`,
  });
  if (error) throw new Error(`grant round insert: ${error.message}`);
  return { id: roundId, arms };
}

export type GrantAssignment = {
  /** 'holdout' = control (status-quo reward) */
  arm: string;
  /** Treatment template to issue INSTEAD of the default; null → issue the
   *  caller's status-quo reward (control, unknown arm, or fail-open). */
  overrideTemplateId: string | null;
  /** loop_assignments.id to attach the issued voucher to — null when the
   *  member couldn't be enrolled (no phone / error). */
  assignmentId: string | null;
};

const CONTROL: GrantAssignment = { arm: "holdout", overrideTemplateId: null, assignmentId: null };

/** Enrol a member in a grant loop at the moment a reward is about to be
 *  handed out, and say which voucher template to issue. One arm per member
 *  per round (a second grant in the same round reuses the first arm). */
export async function assignGrantArm(args: {
  supabase: SupabaseClient;
  loop: GrantLoopDef;
  memberId: string;
  brandId?: string;
}): Promise<GrantAssignment> {
  const { supabase, loop, memberId } = args;
  try {
    // Attribution joins orders by phone (like every loop) — a phone-less
    // member can't be measured, so don't enrol them.
    const { data: member } = await supabase
      .from("members").select("phone").eq("id", memberId).maybeSingle();
    const phone = (member?.phone ?? "").trim();
    if (!phone) return CONTROL;

    const round = await currentOpenRound(supabase, loop, args.brandId ?? DEFAULT_BRAND_ID);

    const templateFor = (armKey: string): string | null =>
      armKey === "holdout" ? null : (round.arms.find((a) => a.key === armKey)?.voucher_template_id ?? null);

    // UNIQUE(round_id, member_id): if this member was already assigned this
    // round, stay on that arm — consistency beats re-rolling.
    const { data: existing } = await supabase
      .from("loop_assignments")
      .select("id, arm")
      .eq("round_id", round.id).eq("member_id", memberId)
      .maybeSingle();
    if (existing) {
      return { arm: existing.arm as string, overrideTemplateId: templateFor(existing.arm as string), assignmentId: existing.id as string };
    }

    const picked = pickGrantArm(loop.controlPct, round.arms, Math.random());
    const armKey = picked === "control" ? "holdout" : picked.key;
    const assignmentId = rid("la");
    const { error } = await supabase.from("loop_assignments").insert({
      id: assignmentId,
      round_id: round.id,
      member_id: memberId,
      phone,
      arm: armKey,
      channel: "grant",
    });
    if (error) {
      // Unique-violation race (same member, concurrent grants) → reuse the row
      // that won. Anything else → fail open to control.
      const { data: raced } = await supabase
        .from("loop_assignments")
        .select("id, arm")
        .eq("round_id", round.id).eq("member_id", memberId)
        .maybeSingle();
      if (!raced) return CONTROL;
      return { arm: raced.arm as string, overrideTemplateId: templateFor(raced.arm as string), assignmentId: raced.id as string };
    }
    return { arm: armKey, overrideTemplateId: templateFor(armKey), assignmentId };
  } catch {
    return CONTROL;
  }
}

/** Attach the voucher that was actually issued to the assignment so
 *  measureRound can read its redemption. Keeps the FIRST voucher when a
 *  control grant issues several (single-column attribution; the redemption
 *  signal stays comparable since treatments issue exactly one). */
export async function recordGrantIssue(supabase: SupabaseClient, assignmentId: string, issuedRewardId: string): Promise<void> {
  try {
    await supabase
      .from("loop_assignments")
      .update({ issued_reward_id: issuedRewardId })
      .eq("id", assignmentId)
      .is("issued_reward_id", null);
  } catch { /* attribution-only — never block fulfilment */ }
}
