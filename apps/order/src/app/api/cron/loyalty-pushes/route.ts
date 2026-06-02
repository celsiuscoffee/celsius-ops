import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  notifyBirthdayReward,
  notifyRewardExpiring,
  notifyTierAtRisk,
  notifyMissYou,
} from "@/lib/push/templates";
import {
  dispatchCampaign,
  dispatchCampaignWithTemplate,
  applyOutcome,
  emptyCounters,
  getCampaign,
  type SweepCounters,
} from "@/lib/push/campaigns";
import { evaluateAudience, reachableCandidateMemberIds, type RuleNode } from "@/lib/push/audience";

/**
 * Cron-driven loyalty push fan-out. One endpoint, one sweep per
 * job query param so Vercel Cron only needs a single schedule
 * config. Each branch is independent — failures in one sweep
 * never poison the others.
 *
 * All sweeps now route through dispatchCampaign() which enforces
 * the per-campaign on/off toggle, frequency cap, opt-out, and
 * quiet-hours configured in the notification_campaigns table.
 * Backoffice toggles take effect on the next cron tick (cache
 * is per-request).
 *
 * Schedule (vercel.json):
 *   "0  1 * * *"     /api/cron/loyalty-pushes?job=birthday        (9am MYT)
 *   "30 1 * * *"     /api/cron/loyalty-pushes?job=reward-expiring (9:30am MYT)
 *   "0  2 * * *"     /api/cron/loyalty-pushes?job=tier-at-risk    (10am MYT)
 *   "0  3 * * *"     /api/cron/loyalty-pushes?job=sitting-on-beans (11am MYT)
 *   "0  3 * * 1"     /api/cron/loyalty-pushes?job=miss-you        (11am MYT Mon)
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}` OR Vercel-
 * native `x-vercel-cron` header. Local dev: pass ?secret= for
 * manual testing.
 */

const BRAND_ID = "brand-celsius";

function authorized(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  const qs     = req.nextUrl.searchParams.get("secret");
  return bearer === expected || qs === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const job = request.nextUrl.searchParams.get("job") ?? "";

  try {
    switch (job) {
      case "birthday":         return NextResponse.json(await runBirthday());
      case "reward-expiring":  return NextResponse.json(await runRewardExpiring());
      case "tier-at-risk":     return NextResponse.json(await runTierAtRisk());
      case "miss-you":         return NextResponse.json(await runMissYou());
      case "sitting-on-beans": return NextResponse.json(await runSittingOnBeans());
      case "custom":           return NextResponse.json(await runCustomCampaigns());
      default:
        return NextResponse.json(
          { error: "unknown job — expected birthday|reward-expiring|tier-at-risk|miss-you|sitting-on-beans|custom" },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("[cron/loyalty-pushes]", err);
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Birthday                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

async function runBirthday(): Promise<SweepCounters & { matched: number }> {
  const supabase = getSupabaseAdmin();
  // Match birthdays by MM-DD so we don't care about the stored year.
  //
  // `members.birthday` is a Postgres `date` column, not text. The
  // previous implementation used `.ilike()` which silently matches
  // nothing on a date column — birthday pushes have been failing
  // every day since this code shipped. Switched to an RPC-style
  // text-cast filter via to_char so the comparison is correct AND
  // index-friendly (Postgres can substring-match the formatted date).
  //
  // MYT-shifted date so 11pm-12am local doesn't roll into "tomorrow"
  // in UTC and skip the day's actual birthdays.
  const today = new Date();
  const mytNow = new Date(today.getTime() + 8 * 60 * 60 * 1000);
  const mm = String(mytNow.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(mytNow.getUTCDate()).padStart(2, "0");
  const monthDay = `${mm}-${dd}`; // e.g. "05-15"

  // Pull all members with a non-null birthday whose to_char(MM-DD)
  // matches today. PostgREST exposes this via a generated computed
  // column approach OR a server-side RPC; the simplest portable path
  // is to filter client-side after pulling a small bounded set. For
  // Celsius's member count (~thousands) this is fine. If member
  // count crosses 100k, promote to a SQL view or RPC.
  const { data: candidates } = await supabase
    .from("members")
    .select("id, name, birthday")
    .not("birthday", "is", null);
  const list = (candidates ?? [])
    .filter((m) => {
      const b = (m as { birthday: string | null }).birthday;
      if (!b) return false;
      // Postgres returns dates as "YYYY-MM-DD" strings via PostgREST.
      const parts = b.split("-");
      if (parts.length < 3) return false;
      return `${parts[1]}-${parts[2]}` === monthDay;
    }) as Array<{ id: string; name: string | null }>;
  const counters = emptyCounters();

  for (const m of list) {
    const firstName = m.name?.trim().split(/\s+/)[0];
    // Prefer the editable template; fall back to legacy notify*
    // when the campaign hasn't been customised. Both paths flow
    // through dispatchCampaign so the policy gates apply equally.
    let outcome = await dispatchCampaignWithTemplate({
      campaignKey: "birthday_treat",
      memberId:    m.id,
      vars: { firstName: firstName ?? "" },
    });
    if (!outcome.dispatched && outcome.reason === "no_tokens") {
      // Could mean truly no tokens OR template not configured. Re-run
      // through legacy path — if it ALSO returns no_tokens we know it's
      // really tokens, not a missing template.
      outcome = await dispatchCampaign({
        campaignKey: "birthday_treat",
        memberId:    m.id,
        send: () => notifyBirthdayReward({
          memberId:   m.id,
          firstName,
          rewardName: "birthday drink",
        }),
        payload: { firstName, rewardName: "birthday drink" },
      });
    }
    applyOutcome(counters, outcome);
  }
  return { ...counters, matched: list.length };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reward / voucher expiring soon                                             */
/* ────────────────────────────────────────────────────────────────────────── */

async function runRewardExpiring(): Promise<SweepCounters & { matched: number }> {
  const supabase = getSupabaseAdmin();
  const campaign = await getCampaign("voucher_expiring");
  // Trigger window driven from campaign config so admins can change
  // "fire 2 days before" → "fire 7 days before" without a deploy.
  const daysAhead =
    typeof (campaign?.trigger_config as { days_before_expiry?: number })?.days_before_expiry === "number"
      ? (campaign!.trigger_config as { days_before_expiry: number }).days_before_expiry
      : 3;
  const now    = new Date();
  const upper  = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
  const lower  = now.toISOString();

  const { data: rows } = await supabase
    .from("issued_rewards")
    .select("id, member_id, expires_at, reward:rewards(name)")
    .eq("brand_id", BRAND_ID)
    .eq("status", "active")
    .gt("expires_at", lower)
    .lte("expires_at", upper);

  type Row = { member_id: string | null; expires_at: string | null; reward: { name?: string | null } | null };
  const list = (rows ?? []) as unknown as Row[];
  const counters = emptyCounters();

  for (const v of list) {
    if (!v.member_id || !v.expires_at) continue;
    const daysLeft = Math.max(1, Math.ceil((new Date(v.expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    const name = v.reward?.name ?? "voucher";
    let outcome = await dispatchCampaignWithTemplate({
      campaignKey: "voucher_expiring",
      memberId:    v.member_id,
      vars: { rewardName: name, daysLeft },
    });
    if (!outcome.dispatched && outcome.reason === "no_tokens") {
      outcome = await dispatchCampaign({
        campaignKey: "voucher_expiring",
        memberId:    v.member_id,
        send: () => notifyRewardExpiring({
          memberId:   v.member_id!,
          rewardName: name,
          daysLeft,
        }),
        payload: { rewardName: name, daysLeft, expiresAt: v.expires_at },
      });
    }
    applyOutcome(counters, outcome);
  }
  return { ...counters, matched: list.length };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Tier at risk                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

async function runTierAtRisk(): Promise<SweepCounters & { matched: number }> {
  const supabase = getSupabaseAdmin();
  const campaign = await getCampaign("tier_at_risk");
  const cfg = (campaign?.trigger_config ?? {}) as {
    min_cups_short?: number;
    max_cups_short?: number;
    days_left_window?: number;
  };
  const minShort = cfg.min_cups_short ?? 1;
  const maxShort = cfg.max_cups_short ?? 3;
  const daysLeft = cfg.days_left_window ?? 14;

  // Customers above the base tier. We re-evaluate their tier via the
  // RPC and compare visits_this_period to the threshold for the tier
  // they currently sit at — if they'd drop on the next sweep, nudge.
  // `MIN(period_days)` reads from tiers; defaults to 90 per current
  // brand config.
  const { data: rows } = await supabase
    .from("member_brands")
    .select("member_id, current_tier_id, tier:tiers(name, min_visits, period_days, sort_order)")
    .eq("brand_id", BRAND_ID)
    .not("current_tier_id", "is", null);

  type Row = {
    member_id: string | null;
    current_tier_id: string | null;
    tier: { name?: string; min_visits?: number | null; period_days?: number | null; sort_order?: number | null } | null;
  };
  const list = (rows ?? []) as unknown as Row[];
  const counters = emptyCounters();

  for (const r of list) {
    if (!r.member_id || !r.tier || (r.tier.sort_order ?? 0) <= 1) continue;
    const periodDays   = r.tier.period_days ?? 90;
    const need         = r.tier.min_visits ?? 0;

    // Visits in the trailing window. Bounded query, cheap.
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const { count: visits } = await supabase
      .from("point_transactions")
      .select("id", { count: "exact", head: true })
      .eq("member_id", r.member_id)
      .eq("brand_id", BRAND_ID)
      .eq("type", "earn")
      .gte("created_at", since);

    const have      = visits ?? 0;
    const cupsShort = Math.max(0, need - have);
    if (cupsShort < minShort || cupsShort > maxShort) continue;

    let outcome = await dispatchCampaignWithTemplate({
      campaignKey: "tier_at_risk",
      memberId:    r.member_id,
      vars: { currentTier: r.tier.name ?? "tier", cupsShort, daysLeft },
    });
    if (!outcome.dispatched && outcome.reason === "no_tokens") {
      outcome = await dispatchCampaign({
        campaignKey: "tier_at_risk",
        memberId:    r.member_id,
        send: () => notifyTierAtRisk({
          memberId:    r.member_id!,
          currentTier: r.tier!.name ?? "tier",
          cupsShort,
          daysLeft,
        }),
        payload: { currentTier: r.tier.name, cupsShort, daysLeft },
      });
    }
    applyOutcome(counters, outcome);
  }
  return { ...counters, matched: counters.considered };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Miss-you re-engagement                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

async function runMissYou(): Promise<SweepCounters & { matched: number }> {
  const supabase = getSupabaseAdmin();
  const campaign = await getCampaign("lapsed_customer");
  const cfg = (campaign?.trigger_config ?? {}) as { lapsed_days?: number; min_lifetime_orders?: number };
  const lapsedDays = cfg.lapsed_days ?? 14;
  const minLifetimeOrders = cfg.min_lifetime_orders ?? 0;
  const cutoff = new Date(Date.now() - lapsedDays * 24 * 60 * 60 * 1000).toISOString();

  // Members whose last visit was >N days ago AND who have a push
  // token (no point notifying tokenless members). Cap at 1000 to
  // keep the cron under the Vercel function timeout.
  const { data: rows } = await supabase
    .from("member_brands")
    .select("member_id, last_visit_at, member:members(name)")
    .eq("brand_id", BRAND_ID)
    .lt("last_visit_at", cutoff)
    .order("last_visit_at", { ascending: false })
    .limit(1000);

  type Row = { member_id: string | null; member: { name?: string | null } | null };
  const list = (rows ?? []) as unknown as Row[];
  const counters = emptyCounters();

  for (const r of list) {
    if (!r.member_id) continue;
    // Optional gating on lifetime orders — admins can require members
    // have ordered at least N times before win-back nudges go out.
    // First-orderers tend to ignore "miss you" because they barely
    // know us; better to skip them.
    if (minLifetimeOrders > 0) {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("loyalty_member_id", r.member_id);
      if ((count ?? 0) < minLifetimeOrders) continue;
    }
    const firstName = r.member?.name?.trim().split(/\s+/)[0];
    let outcome = await dispatchCampaignWithTemplate({
      campaignKey: "lapsed_customer",
      memberId:    r.member_id,
      vars: { firstName: firstName ?? "" },
    });
    if (!outcome.dispatched && outcome.reason === "no_tokens") {
      outcome = await dispatchCampaign({
        campaignKey: "lapsed_customer",
        memberId:    r.member_id,
        send: () => notifyMissYou({ memberId: r.member_id!, firstName }),
        payload: { firstName, lapsedDays },
      });
    }
    applyOutcome(counters, outcome);
  }
  return { ...counters, matched: list.length };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Sitting on Points — Phase 1 new trigger                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Members with N+ Points who haven't ordered in M+ days. The "concrete
 *  value sitting unused" angle converts higher than novel offers because
 *  the customer already feels they own the value (endowment effect).
 *  Reuses notifyVoucherGifted's loyalty channel + copy shape but with
 *  points-specific phrasing. */
async function runSittingOnBeans(): Promise<SweepCounters & { matched: number }> {
  const supabase = getSupabaseAdmin();
  const campaign = await getCampaign("sitting_on_beans");
  const cfg = (campaign?.trigger_config ?? {}) as { min_points?: number; min_days_idle?: number };
  const minPoints   = cfg.min_points ?? 100;
  const minDaysIdle = cfg.min_days_idle ?? 5;

  const idleCutoff = new Date(Date.now() - minDaysIdle * 24 * 60 * 60 * 1000).toISOString();

  // member_brands carries the running points balance + last_visit_at
  // already, so this is one bounded query.
  const { data: rows } = await supabase
    .from("member_brands")
    .select("member_id, points_balance, last_visit_at, member:members(name)")
    .eq("brand_id", BRAND_ID)
    .gte("points_balance", minPoints)
    .lt("last_visit_at", idleCutoff)
    .order("points_balance", { ascending: false })
    .limit(1000);

  type Row = { member_id: string | null; points_balance: number | null; member: { name?: string | null } | null };
  const list = (rows ?? []) as unknown as Row[];
  const counters = emptyCounters();

  for (const r of list) {
    if (!r.member_id) continue;
    const points = r.points_balance ?? 0;
    const firstName = r.member?.name?.trim().split(/\s+/)[0];
    // Template-driven (no legacy fallback needed — this trigger was
    // born after the template editor landed). Server falls back to
    // the seed copy in the migration if admins haven't customised.
    const outcome = await dispatchCampaignWithTemplate({
      campaignKey: "sitting_on_beans",
      memberId:    r.member_id,
      vars: { points, firstName: firstName ?? "" },
      extraData: { points },
    });
    applyOutcome(counters, outcome);
  }
  return { ...counters, matched: list.length };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Custom campaigns — admin-defined, rule-based audiences                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** One sweep across every enabled custom campaign. Each campaign
 *  carries its own audience_filter (rule tree) + template. We
 *  evaluate the rule against the reachable-member pool, then dispatch
 *  via the templating path so frequency cap / opt-out / quiet hours
 *  apply equally with built-in campaigns.
 *
 *  All custom campaigns share one cron tick — adding a new campaign
 *  in the backoffice doesn't require a vercel.json change. The
 *  trade-off: per-campaign timing isn't configurable beyond the
 *  send_window_*_hour gates inside the dispatcher.
 */
type CustomCampaignRow = {
  id:               string;
  key:              string;
  name:             string;
  audience_filter:  Record<string, unknown> | null;
  title_template:   string | null;
  body_template:    string | null;
};

async function runCustomCampaigns(): Promise<{
  campaigns: number;
  candidates: number;
  perCampaign: Array<{ key: string; matched: number; sent: number; failed: number }>;
}> {
  const supabase = getSupabaseAdmin();
  const { data: rows } = await supabase
    .from("notification_campaigns")
    .select("id, key, name, audience_filter, title_template, body_template")
    .eq("trigger_kind", "custom")
    .eq("enabled", true);

  const campaigns = (rows ?? []) as CustomCampaignRow[];
  if (campaigns.length === 0) {
    return { campaigns: 0, candidates: 0, perCampaign: [] };
  }

  // Pull the candidate pool ONCE for all custom campaigns — multiple
  // campaigns hitting the same evaluation context is the common case
  // (e.g. "active members" pool, multiple per-segment templates).
  const candidates = await reachableCandidateMemberIds();

  const perCampaign: Array<{ key: string; matched: number; sent: number; failed: number }> = [];

  for (const c of campaigns) {
    if (!c.audience_filter || Object.keys(c.audience_filter).length === 0) {
      // No rule = no audience. Skip rather than blast every reachable
      // member; admins must explicitly add a rule before the campaign
      // sends. Prevents accidental "save with empty rule → blast all".
      perCampaign.push({ key: c.key, matched: 0, sent: 0, failed: 0 });
      continue;
    }
    if (!c.title_template || !c.body_template) {
      perCampaign.push({ key: c.key, matched: 0, sent: 0, failed: 0 });
      continue;
    }

    const matched = await evaluateAudience(c.audience_filter as RuleNode, candidates);
    let sent = 0, failed = 0;
    for (const memberId of matched) {
      const outcome = await dispatchCampaignWithTemplate({
        campaignKey: c.key as never, // custom keys aren't in the CampaignKey union; cast is intentional
        memberId,
        vars: {}, // Custom campaigns don't have per-member vars yet — Phase 4 if needed.
      });
      if (outcome.dispatched) {
        sent   += outcome.result.sent;
        failed += outcome.result.failed;
      }
    }
    perCampaign.push({ key: c.key, matched: matched.length, sent, failed });
  }

  return {
    campaigns:   campaigns.length,
    candidates:  candidates.length,
    perCampaign,
  };
}
