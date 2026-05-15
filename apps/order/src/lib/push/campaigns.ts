import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { SendResult } from "./send";

/**
 * Campaign-aware dispatcher. Wraps the per-flow `notify*` functions
 * in templates.ts with three policy layers that admins control from
 * the backoffice:
 *
 *   1. Enabled flag — if the campaign row is disabled, skip entirely.
 *   2. Frequency cap — at most N sends per member per X days for this
 *      campaign. Enforced by reading notification_sends.
 *   3. Member opt-out — member_notification_prefs.opt_in_reminders.
 *      Marketing/loyalty campaigns respect this; transactional
 *      order-status pushes go through templates.ts directly and
 *      bypass the dispatcher.
 *
 * Every accepted send is recorded in notification_sends so the
 * backoffice can show per-campaign stats (sent / opened /
 * attributed orders / attributed revenue) and so the next sweep can
 * apply the frequency cap.
 *
 * If the campaign row doesn't exist yet (e.g. a new trigger ships
 * before the seed migration), we fail-OPEN — the underlying notify
 * still fires. That keeps existing flows working through the
 * rollout window. To kill a flow you must toggle the row OFF, not
 * delete it.
 */

export type CampaignKey =
  | "voucher_expiring"
  | "sitting_on_beans"
  | "lapsed_customer"
  | "birthday_treat"
  | "tier_at_risk";

type CampaignRow = {
  id: string;
  key: string;
  enabled: boolean;
  trigger_config: Record<string, unknown>;
  frequency_cap_count: number;
  frequency_cap_days: number;
  send_window_start_hour: number;
  send_window_end_hour: number;
};

/** Cache campaign config for the duration of a single cron run.
 *  The cron is a short-lived function so this never grows large; we
 *  also re-read on each new request. */
let campaignCache: { at: number; rows: Map<string, CampaignRow> } | null = null;
const CACHE_TTL_MS = 30_000;

async function loadCampaigns(): Promise<Map<string, CampaignRow>> {
  if (campaignCache && Date.now() - campaignCache.at < CACHE_TTL_MS) {
    return campaignCache.rows;
  }
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("notification_campaigns")
    .select("id, key, enabled, trigger_config, frequency_cap_count, frequency_cap_days, send_window_start_hour, send_window_end_hour");
  const rows = new Map<string, CampaignRow>();
  for (const r of (data ?? []) as CampaignRow[]) rows.set(r.key, r);
  campaignCache = { at: Date.now(), rows };
  return rows;
}

/** Lookup helper used by cron branches that need to read trigger
 *  params (e.g. days_before_expiry) from the row. */
export async function getCampaign(key: CampaignKey): Promise<CampaignRow | null> {
  const rows = await loadCampaigns();
  return rows.get(key) ?? null;
}

/** Current MYT hour for quiet-hours checks. MYT is UTC+8 with no DST. */
function mytHour(): number {
  const utc = new Date();
  return (utc.getUTCHours() + 8) % 24;
}

/** Is the current MYT hour inside [start, end)? Wraps midnight if
 *  end < start, though our seed data always has start < end. */
function withinSendWindow(start: number, end: number): boolean {
  const h = mytHour();
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** Check the frequency cap by counting sends to this member for this
 *  campaign in the trailing window. Returns true if we may send. */
async function withinFrequencyCap(
  campaignId: string,
  memberId: string,
  capCount: number,
  capDays: number,
): Promise<boolean> {
  if (capCount <= 0 || capDays <= 0) return true;
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - capDays * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("notification_sends")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("member_id", memberId)
    .gte("sent_at", since);
  return (count ?? 0) < capCount;
}

/** Honors the member's marketing opt-out. Defaults to opted-IN if no
 *  row exists (fresh members). */
async function memberOptedIn(memberId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("member_notification_prefs")
    .select("opt_in_reminders")
    .eq("member_id", memberId)
    .maybeSingle();
  if (!data) return true;
  return (data as { opt_in_reminders: boolean }).opt_in_reminders !== false;
}

/** Records the send in notification_sends. We don't await this from
 *  the caller's hot path — it's a fire-and-forget audit + stats
 *  ledger. Failures only affect attribution/dedup, not delivery. */
async function recordSend(args: {
  campaignId: string;
  campaignKey: string;
  memberId: string;
  result: SendResult;
  payload: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.from("notification_sends").insert({
    campaign_id:     args.campaignId,
    campaign_key:    args.campaignKey,
    member_id:       args.memberId,
    delivered_count: args.result.sent,
    payload:         args.payload,
  });
}

/** Outcome from a dispatch attempt. `skipped` carries the reason so
 *  cron summaries can show why a sweep didn't deliver to N members
 *  (disabled / cap / opt-out / quiet hours). */
export type DispatchOutcome =
  | { dispatched: true; result: SendResult }
  | { dispatched: false; reason: "disabled" | "frequency_cap" | "opt_out" | "quiet_hours" | "no_tokens" };

/** Run a notify* function under campaign policy. The caller passes
 *  the underlying send function (e.g. () => notifyRewardExpiring(...))
 *  so the wrapper stays tiny and templates.ts doesn't need to know
 *  about campaigns. The send only fires if all gates pass.
 *
 *  @param payload — recorded in notification_sends.payload for stats.
 *    Should include the rendered title + body + key vars (rewardName,
 *    daysLeft, etc.) so the backoffice can show example sends.
 */
export async function dispatchCampaign(args: {
  campaignKey: CampaignKey;
  memberId: string;
  send: () => Promise<SendResult>;
  payload: Record<string, unknown>;
}): Promise<DispatchOutcome> {
  const campaign = await getCampaign(args.campaignKey);

  // Fail-open when the campaign row is missing — keep legacy callers
  // working through migration rollout. Once seeded, removing a row
  // means re-enabling unrestricted send; toggling enabled=false is
  // the kill switch.
  if (campaign && !campaign.enabled) {
    return { dispatched: false, reason: "disabled" };
  }

  if (campaign && !withinSendWindow(campaign.send_window_start_hour, campaign.send_window_end_hour)) {
    return { dispatched: false, reason: "quiet_hours" };
  }

  if (!(await memberOptedIn(args.memberId))) {
    return { dispatched: false, reason: "opt_out" };
  }

  if (campaign && !(await withinFrequencyCap(
    campaign.id,
    args.memberId,
    campaign.frequency_cap_count,
    campaign.frequency_cap_days,
  ))) {
    return { dispatched: false, reason: "frequency_cap" };
  }

  const result = await args.send();
  if (result.sent === 0 && result.failed === 0 && result.pruned === 0) {
    // Token lookup returned nothing — don't pollute notification_sends
    // with an empty row, but tell the caller why.
    return { dispatched: false, reason: "no_tokens" };
  }

  if (campaign) {
    // Best-effort — failures here only affect stats / future cap
    // queries, never the user's notification.
    void recordSend({
      campaignId:  campaign.id,
      campaignKey: campaign.key,
      memberId:    args.memberId,
      result,
      payload:     args.payload,
    });
  }

  return { dispatched: true, result };
}

/** Aggregate counters returned from a cron sweep so the response body
 *  shows admins what happened. Mirrors the existing SendResult shape
 *  with skip reasons broken out. */
export type SweepCounters = {
  considered: number;
  sent:       number;
  failed:     number;
  pruned:     number;
  skipped: {
    disabled:      number;
    quiet_hours:   number;
    opt_out:       number;
    frequency_cap: number;
    no_tokens:     number;
  };
};

export function emptyCounters(): SweepCounters {
  return {
    considered: 0,
    sent:       0,
    failed:     0,
    pruned:     0,
    skipped: { disabled: 0, quiet_hours: 0, opt_out: 0, frequency_cap: 0, no_tokens: 0 },
  };
}

export function applyOutcome(c: SweepCounters, o: DispatchOutcome): void {
  c.considered++;
  if (o.dispatched) {
    c.sent   += o.result.sent;
    c.failed += o.result.failed;
    c.pruned += o.result.pruned;
  } else {
    c.skipped[o.reason]++;
  }
}
