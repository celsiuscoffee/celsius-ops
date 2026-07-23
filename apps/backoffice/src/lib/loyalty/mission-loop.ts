// MISSION CASH LOOP — measure → tune → kill for the weekly mission pool.
//
// A mission earns its place only if it puts MORE CASH IN THE BANK than doing
// nothing — never on "a sale happened". The trap it exists to catch: a goal at
// or below the brand AOV (~RM28) is completed mostly by members who'd make that
// basket anyway, so the reward voucher is pure cash-out (the "Make it a Meal"
// case: ~RM20 basket, no extra spend, then we give a free drink).
//
// Measurement (no in-app holdout, so baseline stands in for the control):
//   net cash per mission =
//     Σ (completer's net-collected spend in the completion week
//          − that member's own baseline weekly spend) × GP        [incremental cash]
//     − reward cash cost × completers                             [what we gave away]
// A member's completion-week spend vs their own trailing baseline isolates the
// behaviour change; a mission whose completers don't out-spend their baseline is
// cannibalising, and the number goes negative.
//
// Auto-retire: a mission net-cash-negative after >= MIN_COMPLETERS_TO_JUDGE
// measured completers is deactivated (is_active=false) with the reason logged in
// app_settings.mission_loop_stats — same discipline as the SMS-loop kill rule.

import { supabaseAdmin } from "@/lib/loyalty/supabase";

const BRAND = "brand-celsius";
const GP = 0.72;                       // gross-profit rate on incremental spend
const FREE_ITEM_COGS_RM = 3;           // cash to produce one freed drink (BOM ~RM3)
const BASELINE_DAYS = 56;              // trailing window for a member's normal weekly spend
const MEASURE_DAYS = 90;              // only judge completions within this window
const MIN_COMPLETERS_TO_JUDGE = 15;    // evidence floor before auto-retire can fire

type MissionRow = {
  id: string; title: string; is_active: boolean;
  reward_voucher_template_ids: string[] | null; updated_at: string | null;
};
type Completion = { mission_id: string; member_id: string; week_start_at: string; week_end_at: string; completed_at: string };
type OrderRow = { member_id: string; total_rm: number; created_at: string };

export type MissionCashStat = {
  mission_id: string; title: string;
  completers_measured: number;         // completers with a computable baseline
  completers_no_baseline: number;      // new members — incrementality unmeasurable
  incremental_rm: number;              // pooled (completion-week − baseline) spend
  reward_cost_rm: number;              // pooled reward cash cost (COGS / discount RM)
  net_cash_rm: number;                 // incremental × GP − reward cost
  verdict: "cash_positive" | "cash_negative" | "insufficient_data";
  measured_at: string;
  retired?: boolean;
};

// Cash cost of one completion's reward: free item = COGS, discount = RM given.
function rewardCashCost(tpls: Array<{ discount_type: string | null; discount_value: number | null; min_order_value: number | null }>): number {
  let cost = 0;
  for (const t of tpls) {
    const dt = (t.discount_type ?? "").toLowerCase();
    if (dt === "free_item" || dt === "bogo") cost += FREE_ITEM_COGS_RM;
    else if (dt === "flat") cost += (t.discount_value ?? 0) / 100;                       // sen → RM
    else if (dt === "percent" || dt === "percentage") cost += ((t.min_order_value ?? 2800) / 100) * ((t.discount_value ?? 0) / 100); // give at the bar
  }
  return cost;
}

async function memberOrdersInWindow(memberIds: string[], sinceIso: string): Promise<Map<string, OrderRow[]>> {
  const byMember = new Map<string, OrderRow[]>();
  if (memberIds.length === 0) return byMember;

  // phone map for pos_orders (keyed by customer_phone, not member id)
  const phoneToMember = new Map<string, string>();
  for (let i = 0; i < memberIds.length; i += 500) {
    const { data } = await supabaseAdmin.from("members").select("id, phone").in("id", memberIds.slice(i, i + 500));
    for (const m of (data ?? []) as Array<{ id: string; phone: string | null }>) {
      if (m.phone) phoneToMember.set(m.phone.trim(), m.id);
    }
  }
  const push = (memberId: string, row: OrderRow) => {
    const l = byMember.get(memberId) ?? []; l.push(row); byMember.set(memberId, l);
  };

  // Online orders — keyed by loyalty_id (member id) directly.
  for (let i = 0; i < memberIds.length; i += 300) {
    const chunk = memberIds.slice(i, i + 300);
    const { data } = await supabaseAdmin.from("orders")
      .select("loyalty_id, total, created_at").in("loyalty_id", chunk).gte("created_at", sinceIso).gt("total", 0);
    for (const o of (data ?? []) as Array<{ loyalty_id: string | null; total: number | null; created_at: string }>) {
      if (o.loyalty_id) push(o.loyalty_id, { member_id: o.loyalty_id, total_rm: (o.total ?? 0) / 100, created_at: o.created_at });
    }
  }
  // POS orders — keyed by phone, mapped back to member.
  const phones = [...phoneToMember.keys()];
  for (let i = 0; i < phones.length; i += 300) {
    const chunk = phones.slice(i, i + 300);
    const { data } = await supabaseAdmin.from("pos_orders")
      .select("customer_phone, total, created_at").in("customer_phone", chunk).gte("created_at", sinceIso).gt("total", 0);
    for (const o of (data ?? []) as Array<{ customer_phone: string | null; total: number | null; created_at: string }>) {
      const mid = o.customer_phone ? phoneToMember.get(o.customer_phone.trim()) : undefined;
      if (mid) push(mid, { member_id: mid, total_rm: (o.total ?? 0) / 100, created_at: o.created_at });
    }
  }
  return byMember;
}

export async function getMissionCashScorecard(): Promise<MissionCashStat[]> {
  const { data: missions } = await supabaseAdmin
    .from("reward_missions")
    .select("id, title, is_active, reward_voucher_template_ids, updated_at")
    .eq("brand_id", BRAND);
  const missionList = (missions ?? []) as MissionRow[];
  if (missionList.length === 0) return [];

  // reward cash cost per mission (from its voucher templates)
  const allTplIds = [...new Set(missionList.flatMap((m) => m.reward_voucher_template_ids ?? []))];
  const tplById = new Map<string, { discount_type: string | null; discount_value: number | null; min_order_value: number | null }>();
  if (allTplIds.length) {
    const { data: tpls } = await supabaseAdmin.from("voucher_templates")
      .select("id, discount_type, discount_value, min_order_value").in("id", allTplIds);
    for (const t of (tpls ?? []) as Array<{ id: string } & { discount_type: string | null; discount_value: number | null; min_order_value: number | null }>) {
      tplById.set(t.id, { discount_type: t.discount_type, discount_value: t.discount_value, min_order_value: t.min_order_value });
    }
  }
  const missionRewardCost = new Map<string, number>();
  for (const m of missionList) {
    missionRewardCost.set(m.id, rewardCashCost((m.reward_voucher_template_ids ?? []).map((id) => tplById.get(id)).filter(Boolean) as Array<{ discount_type: string | null; discount_value: number | null; min_order_value: number | null }>));
  }

  const measureSince = new Date(Date.now() - MEASURE_DAYS * 86400000).toISOString();
  const { data: comps } = await supabaseAdmin
    .from("mission_assignments")
    .select("mission_id, member_id, week_start_at, week_end_at, completed_at")
    .eq("status", "completed")
    .gte("completed_at", measureSince);
  const completions = (comps ?? []) as Completion[];

  const memberIds = [...new Set(completions.map((c) => c.member_id))];
  const ordersSince = new Date(Date.now() - (MEASURE_DAYS + BASELINE_DAYS) * 86400000).toISOString();
  const ordersByMember = await memberOrdersInWindow(memberIds, ordersSince);

  const now = new Date().toISOString();
  const stats: MissionCashStat[] = [];

  for (const m of missionList) {
    // Judge a mission ONLY on completions under its CURRENT config — completions
    // before its last edit reflect an offer/goal that no longer exists (e.g. the
    // pre-RM35-bar "Make it a Meal"), so counting them would retire a mission we
    // just fixed for its old behaviour. updated_at is the config version.
    const configFrom = m.updated_at ? new Date(m.updated_at).getTime() : 0;
    const rows = completions.filter((c) => c.mission_id === m.id && new Date(c.completed_at).getTime() >= configFrom);
    let incremental = 0, measured = 0, noBaseline = 0;
    for (const c of rows) {
      const orders = ordersByMember.get(c.member_id) ?? [];
      const wStart = new Date(c.week_start_at).getTime();
      const wEnd = new Date(c.week_end_at).getTime();
      const baseStart = wStart - BASELINE_DAYS * 86400000;
      const weekSpend = orders.filter((o) => { const t = new Date(o.created_at).getTime(); return t >= wStart && t <= wEnd; })
        .reduce((s, o) => s + o.total_rm, 0);
      const baseOrders = orders.filter((o) => { const t = new Date(o.created_at).getTime(); return t >= baseStart && t < wStart; });
      if (baseOrders.length === 0) { noBaseline++; continue; }        // new member — can't isolate incrementality
      const baseWeekly = baseOrders.reduce((s, o) => s + o.total_rm, 0) / (BASELINE_DAYS / 7);
      incremental += weekSpend - baseWeekly;
      measured++;
    }
    const rewardCost = (missionRewardCost.get(m.id) ?? 0) * measured;
    const netCash = incremental * GP - rewardCost;
    const verdict: MissionCashStat["verdict"] =
      measured < MIN_COMPLETERS_TO_JUDGE ? "insufficient_data" : netCash >= 0 ? "cash_positive" : "cash_negative";
    stats.push({
      mission_id: m.id, title: m.title,
      completers_measured: measured, completers_no_baseline: noBaseline,
      incremental_rm: +incremental.toFixed(2), reward_cost_rm: +rewardCost.toFixed(2),
      net_cash_rm: +netCash.toFixed(2), verdict, measured_at: now,
    });
  }
  stats.sort((a, b) => b.net_cash_rm - a.net_cash_rm);
  return stats;
}

// Persist the scorecard + auto-retire clear cash-losers. Meant for the daily
// cron. Retirement is conservative (needs MIN_COMPLETERS_TO_JUDGE and a
// negative net) and never un-retires — resuming a mission is an operator action.
export async function runMissionLoop(): Promise<{ measured: number; retired: Array<{ title: string; net_cash_rm: number }> }> {
  const scorecard = await getMissionCashScorecard();
  const retired: Array<{ title: string; net_cash_rm: number }> = [];

  const byId: Record<string, MissionCashStat & { retired_reason?: string }> = {};
  for (const s of scorecard) byId[s.mission_id] = { ...s };

  for (const s of scorecard) {
    if (s.verdict === "cash_negative") {
      // Only retire missions currently active.
      const { data: m } = await supabaseAdmin.from("reward_missions").select("is_active").eq("id", s.mission_id).maybeSingle();
      if (m?.is_active) {
        await supabaseAdmin.from("reward_missions").update({ is_active: false }).eq("id", s.mission_id);
        byId[s.mission_id].retired = true;
        byId[s.mission_id].retired_reason = `auto: RM${s.net_cash_rm}/period net cash after ${s.completers_measured} completers - cannibalising (reward costs more than the incremental spend it drives)`;
        retired.push({ title: s.title, net_cash_rm: s.net_cash_rm });
      }
    }
  }

  await supabaseAdmin.from("app_settings").upsert({ key: "mission_loop_stats", value: byId }, { onConflict: "key" });
  return { measured: scorecard.length, retired };
}
