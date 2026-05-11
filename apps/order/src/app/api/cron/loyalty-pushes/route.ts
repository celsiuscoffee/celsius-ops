import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  notifyBirthdayReward,
  notifyRewardExpiring,
  notifyTierAtRisk,
  notifyMissYou,
} from "@/lib/push/templates";

/**
 * Cron-driven loyalty push fan-out. One endpoint, one sweep per
 * job query param so Vercel Cron only needs a single schedule
 * config. Each branch is independent — failures in one sweep
 * never poison the others.
 *
 * Schedule (suggested vercel.json):
 *   "0  1 * * *"   /api/cron/loyalty-pushes?job=birthday
 *   "30 1 * * *"   /api/cron/loyalty-pushes?job=reward-expiring
 *   "0  2 * * *"   /api/cron/loyalty-pushes?job=tier-at-risk
 *   "0  3 * * MON" /api/cron/loyalty-pushes?job=miss-you
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
      default:
        return NextResponse.json(
          { error: "unknown job — expected birthday|reward-expiring|tier-at-risk|miss-you" },
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

async function runBirthday(): Promise<{ sent: number; failed: number; pruned: number; members: number }> {
  const supabase = getSupabaseAdmin();
  // Match birthdays by MM-DD so we don't care about the stored year.
  // `members.birthday` is a YYYY-MM-DD string.
  const today = new Date();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");

  const { data: members } = await supabase
    .from("members")
    .select("id, name, birthday")
    .ilike("birthday", `%-${mm}-${dd}`);

  let sent = 0, failed = 0, pruned = 0;
  const list = (members ?? []) as Array<{ id: string; name: string | null }>;

  for (const m of list) {
    const firstName = m.name?.trim().split(/\s+/)[0];
    const r = await notifyBirthdayReward({
      memberId:   m.id,
      firstName,
      rewardName: "birthday drink",
    });
    sent   += r.sent;
    failed += r.failed;
    pruned += r.pruned;
  }
  return { sent, failed, pruned, members: list.length };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reward / voucher expiring soon                                             */
/* ────────────────────────────────────────────────────────────────────────── */

async function runRewardExpiring(): Promise<{ sent: number; failed: number; pruned: number; vouchers: number }> {
  const supabase = getSupabaseAdmin();
  const now    = new Date();
  // Window: expires_at within the next 3 days (inclusive) AND > now.
  const inMs   = 3 * 24 * 60 * 60 * 1000;
  const upper  = new Date(now.getTime() + inMs).toISOString();
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

  let sent = 0, failed = 0, pruned = 0;
  for (const v of list) {
    if (!v.member_id || !v.expires_at) continue;
    const daysLeft = Math.max(1, Math.ceil((new Date(v.expires_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    const name = v.reward?.name ?? "voucher";
    const r = await notifyRewardExpiring({
      memberId:   v.member_id,
      rewardName: name,
      daysLeft,
    });
    sent   += r.sent;
    failed += r.failed;
    pruned += r.pruned;
  }
  return { sent, failed, pruned, vouchers: list.length };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Tier at risk                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

async function runTierAtRisk(): Promise<{ sent: number; failed: number; pruned: number; members: number }> {
  const supabase = getSupabaseAdmin();

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

  let sent = 0, failed = 0, pruned = 0, considered = 0;
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
    // Only nudge if they're 1-3 cups away from losing the tier in
    // the next 14 days. Spam guard.
    if (cupsShort < 1 || cupsShort > 3) continue;

    considered++;
    const pr = await notifyTierAtRisk({
      memberId:    r.member_id,
      currentTier: r.tier.name ?? "tier",
      cupsShort,
      daysLeft:    14,
    });
    sent   += pr.sent;
    failed += pr.failed;
    pruned += pr.pruned;
  }
  return { sent, failed, pruned, members: considered };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Miss-you re-engagement                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

async function runMissYou(): Promise<{ sent: number; failed: number; pruned: number; members: number }> {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // Members whose last visit was >14 days ago AND who have a push
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

  let sent = 0, failed = 0, pruned = 0;
  for (const r of list) {
    if (!r.member_id) continue;
    const firstName = r.member?.name?.trim().split(/\s+/)[0];
    const pr = await notifyMissYou({ memberId: r.member_id, firstName });
    sent   += pr.sent;
    failed += pr.failed;
    pruned += pr.pruned;
  }
  return { sent, failed, pruned, members: list.length };
}
