import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { sendSMS } from "@/lib/loyalty/sms";
import { checkCronAuth } from "@celsius/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Scope gate for inactivity reactivation — only blast members whose
// member_brands.joined_at is on/after this date. Widen later by changing
// the constant (or moving to env). Not applied to birthday campaigns
// (birthday trigger fires off birthday data availability instead).
const SCOPE_JOINED_AFTER = "2026-04-01";

// Safety cap across all campaigns per run.
const MAX_PER_RUN = 500;
const BATCH_SIZE = 10;
const SENDER_LABEL = "CelsiusCoffee";

type CampaignRow = {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  message: string | null;
  target_segment: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  sms_sent_count: number | null;
};

type Trigger =
  | { kind: "inactive"; days: number }
  | { kind: "birthday" };

type EligibleMember = {
  member_id: string;
  phone: string;
  name: string | null;
  points_balance: number;
};

function parseTrigger(description: string | null): Trigger | null {
  if (!description) return null;
  const inactive = description.match(/\[AUTO:inactive:(\d+)\]/);
  if (inactive) return { kind: "inactive", days: parseInt(inactive[1], 10) };
  if (/\[AUTO:birthday\]/.test(description)) return { kind: "birthday" };
  return null;
}

function renderMessage(
  template: string,
  vars: { name: string | null; points: number }
): string {
  return template
    .replaceAll("{name}", vars.name || "there")
    .replaceAll("{points}", String(vars.points ?? 0))
    .replaceAll("{outlet}", "Celsius Coffee");
}

type EligibleRaw = {
  member_id: string;
  points_balance: number | null;
  members:
    | { id: string; phone: string; name: string | null; birthday?: string | null }
    | { id: string; phone: string; name: string | null; birthday?: string | null }[]
    | null;
};

function normaliseEligible(rows: EligibleRaw[]): EligibleMember[] {
  return rows
    .map((r) => {
      const mem = Array.isArray(r.members) ? r.members[0] : r.members;
      if (!mem) return null;
      return {
        member_id: r.member_id,
        phone: mem.phone,
        name: mem.name,
        points_balance: r.points_balance ?? 0,
      } satisfies EligibleMember;
    })
    .filter((m): m is EligibleMember => m !== null);
}

async function findInactiveEligible(
  brandId: string,
  days: number,
  limit: number
): Promise<EligibleMember[]> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabaseAdmin
    .from("member_brands")
    .select(
      "member_id, points_balance, last_visit_at, joined_at, members!inner(id, phone, name)"
    )
    .eq("brand_id", brandId)
    .gte("joined_at", SCOPE_JOINED_AFTER)
    .not("last_visit_at", "is", null)
    .lt("last_visit_at", cutoff)
    .limit(limit);
  return normaliseEligible((data || []) as unknown as EligibleRaw[]);
}

async function findBirthdayEligible(
  brandId: string,
  limit: number
): Promise<EligibleMember[]> {
  // We can't filter EXTRACT(MONTH FROM birthday) through the PostgREST query
  // builder, so pull candidates with a non-null birthday and filter in memory.
  // Birthday set is small (~900 members) so this is fine.
  const currentMonth = new Date().getUTCMonth() + 1;
  const { data } = await supabaseAdmin
    .from("member_brands")
    .select(
      "member_id, points_balance, members!inner(id, phone, name, birthday)"
    )
    .eq("brand_id", brandId)
    .not("members.birthday", "is", null);

  const all = normaliseEligibleWithBirthday(
    (data || []) as unknown as EligibleRaw[]
  );
  return all
    .filter((m) => m.birthdayMonth === currentMonth)
    .slice(0, limit)
    .map(({ birthdayMonth: _unused, ...rest }) => rest);
}

function normaliseEligibleWithBirthday(
  rows: EligibleRaw[]
): Array<EligibleMember & { birthdayMonth: number | null }> {
  return rows
    .map((r) => {
      const mem = Array.isArray(r.members) ? r.members[0] : r.members;
      if (!mem || !mem.birthday) return null;
      const d = new Date(mem.birthday);
      if (isNaN(d.getTime())) return null;
      return {
        member_id: r.member_id,
        phone: mem.phone,
        name: mem.name,
        points_balance: r.points_balance ?? 0,
        birthdayMonth: d.getUTCMonth() + 1,
      };
    })
    .filter(
      (m): m is EligibleMember & { birthdayMonth: number } => m !== null
    );
}

async function findAlreadySentPhones(
  campaignId: string,
  phones: string[],
  scope: "all-time" | "this-year"
): Promise<Set<string>> {
  if (phones.length === 0) return new Set();
  let query = supabaseAdmin
    .from("sms_logs")
    .select("phone")
    .eq("campaign_id", campaignId)
    .in("phone", phones);
  if (scope === "this-year") {
    const startOfYear = new Date(
      Date.UTC(new Date().getUTCFullYear(), 0, 1)
    ).toISOString();
    query = query.gte("created_at", startOfYear);
  }
  const { data } = await query;
  return new Set((data || []).map((r: { phone: string }) => r.phone));
}

export async function GET(req: NextRequest) {
  const cronAuth = checkCronAuth(req.headers);
  if (!cronAuth.ok) return NextResponse.json({ error: cronAuth.error }, { status: cronAuth.status });

  const nowIso = new Date().toISOString();

  const { data: campaignRows, error: cErr } = await supabaseAdmin
    .from("campaigns")
    .select(
      "id, brand_id, name, description, message, target_segment, start_date, end_date, is_active, sms_sent_count"
    )
    .eq("is_active", true)
    .in("target_segment", ["inactive", "birthday"])
    .lte("start_date", nowIso)
    .gte("end_date", nowIso);

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const activeAuto: Array<{ campaign: CampaignRow; trigger: Trigger }> = [];
  for (const c of (campaignRows || []) as CampaignRow[]) {
    const trigger = parseTrigger(c.description);
    if (trigger && c.message?.trim()) {
      activeAuto.push({ campaign: c, trigger });
    }
  }

  const results: Array<{
    campaign_id: string;
    campaign_name: string;
    trigger: string;
    eligible: number;
    already_sent: number;
    sent: number;
    failed: number;
    skipped_balance: number;
  }> = [];

  let totalSent = 0;

  for (const { campaign, trigger } of activeAuto) {
    if (totalSent >= MAX_PER_RUN) break;
    const remainingBudget = MAX_PER_RUN - totalSent;

    const eligible =
      trigger.kind === "inactive"
        ? await findInactiveEligible(
            campaign.brand_id,
            trigger.days,
            remainingBudget
          )
        : await findBirthdayEligible(campaign.brand_id, remainingBudget);

    const triggerLabel =
      trigger.kind === "inactive"
        ? `inactive:${trigger.days}d`
        : "birthday";

    if (eligible.length === 0) {
      results.push({
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        trigger: triggerLabel,
        eligible: 0,
        already_sent: 0,
        sent: 0,
        failed: 0,
        skipped_balance: 0,
      });
      continue;
    }

    // Dedup scope: birthday = once per calendar year; inactive = forever
    // (per-campaign, so re-activating a campaign after pause won't re-spam).
    const dedupScope = trigger.kind === "birthday" ? "this-year" : "all-time";
    const phones = eligible.map((e) => e.phone);
    const sentSet = await findAlreadySentPhones(campaign.id, phones, dedupScope);
    const toSend = eligible.filter((e) => !sentSet.has(e.phone));

    if (toSend.length === 0) {
      results.push({
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        trigger: triggerLabel,
        eligible: eligible.length,
        already_sent: eligible.length,
        sent: 0,
        failed: 0,
        skipped_balance: 0,
      });
      continue;
    }

    // Balance check
    let skippedForBalance = 0;
    const apiKey = process.env.SMS123_API_KEY;
    const email = process.env.SMS123_EMAIL;
    if (apiKey && email) {
      try {
        const params = new URLSearchParams({ apiKey, email });
        const balRes = await fetch(
          `https://www.sms123.net/api/getBalance.php?${params.toString()}`
        );
        const balData = await balRes.json();
        if (balData.status === "ok") {
          const balance = parseFloat(String(balData.balance).replace(/,/g, ""));
          if (balance < toSend.length) {
            skippedForBalance = toSend.length;
            results.push({
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              trigger: triggerLabel,
              eligible: eligible.length,
              already_sent: sentSet.size,
              sent: 0,
              failed: 0,
              skipped_balance: skippedForBalance,
            });
            continue;
          }
        }
      } catch {
        // Continue — individual sends can still fail gracefully.
      }
    }

    const provider = (process.env.SMS_PROVIDER || "console").trim();
    const template = campaign.message!;
    let sent = 0;
    let failed = 0;
    const logs: Array<{
      id: string;
      brand_id: string;
      campaign_id: string;
      member_id: string;
      phone: string;
      message: string;
      status: string;
      provider: string;
      provider_message_id: string | null;
      error: string | null;
    }> = [];

    for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
      if (totalSent + sent >= MAX_PER_RUN) break;

      const batch = toSend.slice(i, i + BATCH_SIZE);
      const rendered = batch.map((m) =>
        renderMessage(template, { name: m.name, points: m.points_balance })
      );
      const finalMessages = rendered.map(
        (body) => `RM0 [${SENDER_LABEL}] ${body}`
      );

      const batchResults = await Promise.all(
        batch.map((m, idx) => sendSMS(m.phone, finalMessages[idx]))
      );

      for (let j = 0; j < batch.length; j++) {
        const m = batch[j];
        const result = batchResults[j];
        if (result.success) sent++;
        else failed++;

        logs.push({
          id: `sms-${Date.now()}-${i + j}-${Math.random().toString(36).slice(2, 6)}`,
          brand_id: campaign.brand_id,
          campaign_id: campaign.id,
          member_id: m.member_id,
          phone: m.phone,
          message: finalMessages[j],
          status: result.success ? "sent" : "failed",
          provider,
          provider_message_id: result.messageId || null,
          error: result.error || null,
        });
      }
    }

    if (logs.length > 0) {
      await supabaseAdmin.from("sms_logs").insert(logs);
    }

    if (sent > 0) {
      const fallback = async () => {
        await supabaseAdmin
          .from("campaigns")
          .update({
            sms_sent_count: (campaign.sms_sent_count || 0) + sent,
            sms_sent_at: new Date().toISOString(),
          })
          .eq("id", campaign.id);
      };
      await supabaseAdmin
        .rpc("increment_sms_count", {
          p_campaign_id: campaign.id,
          p_count: sent,
        })
        .then(null, fallback);
    }

    totalSent += sent;
    results.push({
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      trigger: triggerLabel,
      eligible: eligible.length,
      already_sent: sentSet.size,
      sent,
      failed,
      skipped_balance: 0,
    });
  }

  return NextResponse.json({
    checked_at: nowIso,
    scope_joined_after: SCOPE_JOINED_AFTER,
    max_per_run: MAX_PER_RUN,
    campaigns_evaluated: activeAuto.length,
    total_sent: totalSent,
    results,
  });
}
