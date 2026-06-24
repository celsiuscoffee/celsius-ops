// GET /api/loyalty/me/missions/active — the customer's 3 weekly
// challenges. Replaces the old single-active picker model.
//
// Lazy seed: if the customer has no assignments for the current
// Mon 00:00 → Sun 23:59 (Asia/Kuala_Lumpur) window, three random
// missions are pulled from the active pool (respecting cooldowns) and
// inserted before returning. Means new signups land on a populated
// challenges section immediately and members get a fresh trio every
// week without a separate cron firing — opening the rewards screen IS
// the rotation trigger.
//
// Cooldown handling mirrors the legacy /missions/pool logic: a mission
// the member completed within `cooldown_weeks` is filtered out of the
// candidate pool so the same challenge doesn't repeat.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();
const TARGET_ACTIVE_PER_WEEK = 3;

// Asia/Kuala_Lumpur (UTC+8) week window — Mon 00:00 → Sun 23:59 local.
// Stored as UTC ISO so the comparison against assignment rows is exact.
const MY_OFFSET_HOURS = 8;
function currentWeekWindow(now = new Date()): { startIso: string; endIso: string } {
  const my = new Date(now.getTime() + MY_OFFSET_HOURS * 60 * 60 * 1000);
  const day = my.getUTCDay();              // 0 = Sun
  const daysFromMonday = (day + 6) % 7;    // Mon → 0
  const monMidnight = new Date(my);
  monMidnight.setUTCDate(my.getUTCDate() - daysFromMonday);
  monMidnight.setUTCHours(0, 0, 0, 0);
  const sunEnd = new Date(monMidnight);
  sunEnd.setUTCDate(monMidnight.getUTCDate() + 6);
  sunEnd.setUTCHours(23, 59, 59, 999);
  const startUtc = new Date(monMidnight.getTime() - MY_OFFSET_HOURS * 60 * 60 * 1000);
  const endUtc = new Date(sunEnd.getTime() - MY_OFFSET_HOURS * 60 * 60 * 1000);
  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
}

type MissionPoolRow = {
  id: string;
  title: string;
  description: string;
  icon: string;
  difficulty: "easy" | "medium" | "hard";
  goal: { type: string; threshold: number };
  reward_voucher_template_ids: string[] | null;
  reward_bonus_beans: number;
  cooldown_weeks: number;
};

type AssignmentJoinRow = {
  id: string;
  progress_current: number;
  progress_target: number;
  status: string;
  week_end_at: string;
  completed_at: string | null;
  reward_missions: {
    id: string;
    title: string;
    description: string;
    icon: string;
    difficulty: "easy" | "medium" | "hard";
    goal: { type: string; threshold: number };
    reward_voucher_template_ids: string[] | null;
    reward_bonus_beans: number;
  };
};

// Builds the human-readable reward line shown on the Challenge card.
// Vouchers are the only reward type here — Points bonuses were dropped
// after the "challenges rewards, focus on rewards only" call. Shows the
// actual voucher title when exactly one is attached so the customer
// reads "Free Drink" instead of a vague "1 voucher".
function summariseReward(
  m: { reward_voucher_template_ids: string[] | null },
  titles: Map<string, string>,
): string {
  const ids = m.reward_voucher_template_ids ?? [];
  if (ids.length === 0) return "Reward TBD";
  if (ids.length === 1) return titles.get(ids[0]) ?? "1 voucher";
  return `${ids.length} vouchers`;
}

// Pull every voucher_template_id referenced by the given assignments
// and resolve each to a title in one trip. Tiny query (≤ 9 ids in
// practice — 3 active missions × up to a couple vouchers each).
async function loadVoucherTitles(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rows: AssignmentJoinRow[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of rows) {
    for (const id of r.reward_missions.reward_voucher_template_ids ?? []) {
      ids.add(id);
    }
  }
  if (ids.size === 0) return new Map();
  const { data } = await supabase
    .from("voucher_templates")
    .select("id, title")
    .in("id", Array.from(ids));
  return new Map((data ?? []).map((t) => [t.id as string, t.title as string]));
}

// For COMPLETED assignments, the customer's wallet voucher (issued at
// completion time) is the source of truth — not the mission's current
// reward_voucher_template_ids. If the admin re-wires a mission's
// reward later, historical wallet vouchers stay on the old template;
// the rewards card must show what's actually IN the wallet, not what
// the mission would grant if completed today.
async function loadIssuedTitlesForCompleted(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rows: AssignmentJoinRow[],
): Promise<Map<string, string>> {
  const completedIds = rows
    .filter((r) => r.status === "completed")
    .map((r) => r.id);
  if (completedIds.length === 0) return new Map();
  const { data } = await supabase
    .from("issued_rewards")
    .select("source_ref_id, title, status, issued_at")
    .eq("source_type", "mission")
    .in("source_ref_id", completedIds)
    .order("issued_at", { ascending: false });
  const out = new Map<string, string>();
  for (const v of data ?? []) {
    const ref = v.source_ref_id as string;
    // First-encountered wins, which thanks to the ORDER BY is the
    // most recently issued voucher — handles the rare case where a
    // single completion issued multiple vouchers.
    if (!out.has(ref) && v.title) {
      out.set(ref, v.title as string);
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const supabase = getSupabaseAdmin();
  const { startIso, endIso } = currentWeekWindow();

  // 0) Self-healing expiry: flip this member's leftover past-week active
  //    assignments to 'expired'. Weekly assignments used to linger 'active'
  //    forever, so a single order could complete the same mission for every
  //    un-expired past week at once (the stale-week stacking bug — one visit
  //    minting 3× Free Coffee). The order hook's week-window guard already
  //    blocks crediting them; this keeps the data clean on each visit, matching
  //    the lazy "opening the screen IS the rotation trigger" model (no cron).
  await supabase
    .from("mission_assignments")
    .update({ status: "expired", expired_at: new Date().toISOString() })
    .eq("member_id", r.member.memberId)
    .eq("status", "active")
    .lt("week_end_at", startIso);

  // 1) Fetch existing assignments for the current week.
  const { data: existing } = await supabase
    .from("mission_assignments")
    .select(`
      id, progress_current, progress_target, status, week_end_at, completed_at,
      reward_missions!inner(id, title, description, icon, difficulty, goal,
        reward_voucher_template_ids, reward_bonus_beans)
    `)
    .eq("member_id", r.member.memberId)
    .eq("week_start_at", startIso)
    .order("created_at", { ascending: true });

  const existingRows = (existing ?? []) as unknown as AssignmentJoinRow[];

  // 2) If the customer already has assignments for this week (any
  //    status — active or completed), return them. We don't top up
  //    completed assignments — once you finish, you finish for the
  //    week; next Monday brings a fresh three.
  if (existingRows.length > 0) {
    const [titles, issuedTitles] = await Promise.all([
      loadVoucherTitles(supabase, existingRows),
      loadIssuedTitlesForCompleted(supabase, existingRows),
    ]);
    return NextResponse.json(existingRows.map((row) => toResponseShape(row, titles, issuedTitles)));
  }

  // 3) Lazy seed — pull up to TARGET_ACTIVE_PER_WEEK from the active
  //    pool, filter cooldowns, insert, return.
  const now = new Date().toISOString();
  const { data: poolRawAll } = await supabase
    .from("reward_missions")
    .select("id, title, description, icon, difficulty, goal, reward_voucher_template_ids, reward_bonus_beans, cooldown_weeks, starts_at, ends_at")
    .eq("brand_id", BRAND_ID)
    .eq("is_active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`);

  // Exclude the referrals_count mission from the weekly auto-rotation.
  // It's now config-only — holds the per-referral voucher templates for
  // maybeRewardReferralOnFirstOrder — and pays out per-referral rather
  // than via weekly mission completion. Surfacing it as a customer
  // challenge would mislead members ("complete 1 referral to earn X")
  // since X already lands per-referral regardless of the mission.
  const poolRaw = (poolRawAll ?? []).filter(
    (m) => (m.goal as { type?: string } | null)?.type !== "referrals_count",
  );

  if (poolRaw.length === 0) {
    return NextResponse.json([]);
  }

  // Cooldown filter — exclude missions the member completed within
  // each mission's cooldown_weeks window.
  const longestCooldown = Math.max(...poolRaw.map((m) => m.cooldown_weeks ?? 4));
  const cooldownStart = new Date(
    Date.now() - longestCooldown * 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: recent } = await supabase
    .from("mission_assignments")
    .select("mission_id, completed_at")
    .eq("member_id", r.member.memberId)
    .eq("status", "completed")
    .gte("completed_at", cooldownStart);

  const blocked = new Set<string>();
  for (const a of recent ?? []) {
    if (!a.completed_at) continue;
    const m = poolRaw.find((x) => x.id === a.mission_id);
    if (!m) continue;
    const weeks = m.cooldown_weeks ?? 4;
    const expires = new Date(a.completed_at).getTime() + weeks * 7 * 24 * 60 * 60 * 1000;
    if (expires > Date.now()) blocked.add(m.id);
  }

  const eligible = poolRaw.filter((m) => !blocked.has(m.id)) as unknown as MissionPoolRow[];
  if (eligible.length === 0) {
    return NextResponse.json([]);
  }

  // Fisher-Yates shuffle so each fetch lands a different random trio
  // when the pool is large. Picking the same 3 every week would make
  // the rotation feel pointless.
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picks = shuffled.slice(0, TARGET_ACTIVE_PER_WEEK);

  // Insert assignments. The (member_id, week_start_at, mission_id)
  // unique constraint protects against a race where two parallel
  // requests both try to seed — the second insert no-ops on conflict.
  const rows = picks.map((m) => ({
    member_id: r.member.memberId,
    mission_id: m.id,
    week_start_at: startIso,
    week_end_at: endIso,
    progress_current: 0,
    progress_target: m.goal?.threshold ?? 1,
    status: "active" as const,
  }));

  const { data: inserted } = await supabase
    .from("mission_assignments")
    .upsert(rows, {
      onConflict: "member_id,week_start_at,mission_id",
      ignoreDuplicates: true,
    })
    .select(`
      id, progress_current, progress_target, status, week_end_at, completed_at,
      reward_missions!inner(id, title, description, icon, difficulty, goal,
        reward_voucher_template_ids, reward_bonus_beans)
    `);

  // Bump pick counters (analytics, best-effort).
  for (const p of picks) {
    supabase.rpc("increment_mission_picked", { mission_id_param: p.id }).then(
      () => {},
      () => {},
    );
  }

  const insertedRows = (inserted ?? []) as unknown as AssignmentJoinRow[];
  const titles = await loadVoucherTitles(supabase, insertedRows);
  // Freshly seeded assignments are always 'active' so issued-voucher
  // overrides are irrelevant; pass an empty map for the param.
  return NextResponse.json(insertedRows.map((row) => toResponseShape(row, titles, new Map())));
}

function toResponseShape(
  a: AssignmentJoinRow,
  titles: Map<string, string>,
  issuedTitles: Map<string, string>,
) {
  // For completed missions, the customer's actual wallet voucher is
  // authoritative. Falling back to the current mission config only
  // when the voucher row isn't found (cold cache / data race).
  const issuedTitle = a.status === "completed" ? issuedTitles.get(a.id) : undefined;
  const rewardSummary = issuedTitle ?? summariseReward(a.reward_missions, titles);

  return {
    assignment_id: a.id,
    id: a.reward_missions.id,
    title: a.reward_missions.title,
    description: a.reward_missions.description,
    icon: a.reward_missions.icon,
    difficulty: a.reward_missions.difficulty,
    // Surfacing goal_type so the client can pick the right progress
    // formatter — "RM60 of RM100" for Big Bill (sen), "2/3 cups" for
    // Group Order, "0/1 friends" for Refer-a-Friend.
    goal_type: a.reward_missions.goal?.type ?? "orders_count",
    goal_threshold: a.reward_missions.goal?.threshold ?? a.progress_target,
    reward_summary: rewardSummary,
    progress_current: a.progress_current,
    status: a.status,
    week_end_at: a.week_end_at,
    completed_at: a.completed_at,
  };
}
