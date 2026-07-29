/**
 * Sync what a Smart campaign is actually SHOWING and WHERE it sends the click.
 *
 * The ads sync historically covered accounts, campaigns, metrics, keywords and
 * search terms — i.e. what we spent and what matched, but nothing about the ad
 * itself. So "optimise the ad text / image / landing page" could not be
 * answered, let alone acted on: nobody could see the current copy, the images,
 * the final URL, the geo radius or the ad schedule.
 *
 * This module makes those visible. It is deliberately READ-ONLY. The autopilot
 * mutates budgets and negative keywords because both are cheap to reverse and
 * measurable within days; ad copy is brand-facing and its effect is slow, so
 * the right first move is observation, not automation. The 2026-07-21
 * consolidation regression is the standing lesson on mutating a surface
 * nothing verifies.
 *
 * Every query is best-effort per campaign: Smart campaigns expose different
 * resources depending on how they were created, and a missing resource must
 * degrade to "we could not read that" rather than failing the nightly sync.
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { randomUUID } from "crypto";

export type CreativeKind = "ad" | "setting" | "geo" | "schedule" | "asset" | "hour_profile";

/**
 * Safely describe a thrown value.
 *
 * google-ads-api rejects with `{ errors: [{ message }] }` and NO top-level
 * `.message` — exclude-term.ts has handled that shape since it was written.
 * The first cut of this file did `(err as Error).message.slice(0, 300)`, so
 * `.message` was undefined, `.slice` threw a TypeError *inside the catch
 * block*, that TypeError escaped the per-kind handler, and one unavailable
 * resource killed the whole campaign: the 2026-07-29 run logged
 * "Cannot read properties of undefined (reading 'slice')" for all three
 * campaigns and wrote zero rows.
 *
 * The error path is the one path that must never throw — it only runs when
 * something has already gone wrong, so a failure here converts a partial
 * result into total silence.
 */
export function errMessage(err: unknown, max = 300): string {
  const e = err as { errors?: Array<{ message?: string }>; message?: unknown } | null | undefined;
  const fromArray = Array.isArray(e?.errors)
    ? e.errors.map((x) => x?.message).filter(Boolean).join(" | ")
    : "";
  const raw =
    fromArray || (typeof e?.message === "string" ? e.message : "") || safeString(err) || "unknown error";
  return raw.slice(0, max);
}

function safeString(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
  } catch {
    return "unserialisable error";
  }
}

// Trading hours measured from the TILL, not from Outlet.openTime/closeTime.
// The config says 08:00-22:00; the tills say first sale ~07:46 and last ~22:47,
// with 184 real transactions inside the 22:00 hour (2.3% of the day). Acting on
// the config would have switched ads off during a genuinely trading hour.
// Hours 23:00-06:59 carry ZERO transactions across every outlet — that, and
// only that, is the provably dead window.
export const DEAD_HOURS = [23, 0, 1, 2, 3, 4, 5, 6];

/**
 * The ad-serving window the owner approved on 2026-07-29: 07:30–22:00 MYT.
 *
 * DEAD_HOURS answers "when is the till provably silent"; this answers the
 * different question "when is it still worth BUYING a click", which needs a
 * conversion runway — someone who sees an ad has to decide and travel.
 *
 * Owner proposed 07:30–21:30 ("after 10 people wont come"). The 15-minute
 * profile says the arrival instinct is right but lands ~30 min later:
 *
 *   21:30  136 txns / RM3,774     21:45  129 / RM3,918
 *   22:00  108 txns / RM2,947     22:15   62 / RM1,582
 *   22:30   13 txns / RM299       22:45    1 / RM14
 *
 * 21:30–22:29 is still ~RM12.2k of real trade, so a 21:30 cutoff would go dark
 * during four of the busiest remaining quarter-hours. The genuine cliff is
 * 22:30 (62 → 13 → 1). Ending at 22:00 leaves a ~30-minute runway into that
 * cliff. Start 07:30 is the owner's, unchanged — first sale is 07:46, so ads
 * should be live for people searching on the way in.
 */
export const AD_WINDOW = { startHour: 7, startMinute: 30, endHour: 22, endMinute: 0 } as const;

type Row = { kind: CreativeKind; ref: string; payload: Record<string, unknown> };

/** GAQL per kind. Each is optional — a campaign may legitimately have none. */
const QUERIES: Array<{ kind: CreativeKind; gaql: (campaignId: string) => string }> = [
  {
    // The served ad: headlines + descriptions are the ad TEXT, final_urls the
    // LANDING PAGE. Smart campaigns use ad type SMART_CAMPAIGN_AD.
    kind: "ad",
    gaql: (id) => `
      SELECT ad_group_ad.ad.resource_name,
             ad_group_ad.ad.type,
             ad_group_ad.ad.final_urls,
             ad_group_ad.ad.smart_campaign_ad.headlines,
             ad_group_ad.ad.smart_campaign_ad.descriptions,
             ad_group_ad.status
      FROM ad_group_ad
      WHERE campaign.id = ${id}
    `,
  },
  {
    // Landing page + business identity as configured on the campaign itself.
    kind: "setting",
    gaql: (id) => `
      SELECT smart_campaign_setting.resource_name,
             smart_campaign_setting.final_url,
             smart_campaign_setting.advertising_language_code,
             smart_campaign_setting.business_name,
             smart_campaign_setting.business_profile_location
      FROM smart_campaign_setting
      WHERE campaign.id = ${id}
    `,
  },
  {
    // Geo: proximity radius is the single biggest lever on local junk traffic —
    // a wide radius is why "restaurants near me" 40km away ever matched.
    kind: "geo",
    gaql: (id) => `
      SELECT campaign_criterion.resource_name,
             campaign_criterion.type,
             campaign_criterion.negative,
             campaign_criterion.proximity.radius,
             campaign_criterion.proximity.radius_units,
             campaign_criterion.proximity.address.city_name,
             campaign_criterion.proximity.address.postal_code,
             campaign_criterion.location.geo_target_constant
      FROM campaign_criterion
      WHERE campaign.id = ${id}
        AND campaign_criterion.type IN ('PROXIMITY', 'LOCATION')
    `,
  },
  {
    // Ad schedule: serving outside opening hours is pure waste.
    kind: "schedule",
    gaql: (id) => `
      SELECT campaign_criterion.resource_name,
             campaign_criterion.ad_schedule.day_of_week,
             campaign_criterion.ad_schedule.start_hour,
             campaign_criterion.ad_schedule.end_hour
      FROM campaign_criterion
      WHERE campaign.id = ${id}
        AND campaign_criterion.type = 'AD_SCHEDULE'
    `,
  },
  {
    // Images/logos actually being served.
    kind: "asset",
    gaql: (id) => `
      SELECT campaign_asset.resource_name,
             campaign_asset.field_type,
             asset.type,
             asset.name,
             asset.image_asset.full_size.url,
             asset.text_asset.text
      FROM campaign_asset
      WHERE campaign.id = ${id}
    `,
  },
];

/**
 * Pure: fold hour-segmented rows into a 24-slot spend profile and price the
 * dead window. This exists because the schedule question was being answered by
 * assertion — "we must be wasting money at 3am" — with no way to check. Nobody
 * searches for coffee at 3am, so the honest answer may well be "almost
 * nothing", and that is worth knowing BEFORE touching the ad schedule.
 */
export function hourProfile(
  rows: Array<{ hour: number; costMyr: number; clicks: number; impressions: number }>,
  days: number,
): {
  byHour: Record<number, { costMyr: number; clicks: number; impressions: number }>;
  deadCostMyr: number;
  totalCostMyr: number;
  deadPct: number;
  deadCostPerDayMyr: number;
} {
  const byHour: Record<number, { costMyr: number; clicks: number; impressions: number }> = {};
  for (let h = 0; h < 24; h++) byHour[h] = { costMyr: 0, clicks: 0, impressions: 0 };
  for (const r of rows) {
    const slot = byHour[r.hour];
    if (!slot) continue;
    slot.costMyr += r.costMyr;
    slot.clicks += r.clicks;
    slot.impressions += r.impressions;
  }
  for (const h of Object.keys(byHour)) {
    const s = byHour[Number(h)];
    s.costMyr = Math.round(s.costMyr * 100) / 100;
  }
  const deadCostMyr =
    Math.round(DEAD_HOURS.reduce((sum, h) => sum + (byHour[h]?.costMyr ?? 0), 0) * 100) / 100;
  const totalCostMyr =
    Math.round(Object.values(byHour).reduce((sum, s) => sum + s.costMyr, 0) * 100) / 100;
  return {
    byHour,
    deadCostMyr,
    totalCostMyr,
    deadPct: totalCostMyr > 0 ? Math.round((deadCostMyr / totalCostMyr) * 1000) / 10 : 0,
    deadCostPerDayMyr: days > 0 ? Math.round((deadCostMyr / days) * 100) / 100 : 0,
  };
}

/**
 * Pull every creative/targeting surface for one campaign and upsert it.
 * Returns per-kind counts plus any kinds Google refused, so a silent blind
 * spot shows up as data rather than as nothing.
 */
export async function syncCampaignCreative(
  campaignPk: string,
): Promise<{ rows: number; byKind: Record<string, number>; errors: Record<string, string> }> {
  const campaign = await prisma.adsCampaign.findUnique({
    where: { id: campaignPk },
    include: { account: { select: { customerId: true } } },
  });
  if (!campaign) return { rows: 0, byKind: {}, errors: { campaign: "not found" } };

  const customer = getCustomer(campaign.account.customerId.replace(/-/g, ""));
  const collected: Row[] = [];
  const errors: Record<string, string> = {};
  const byKind: Record<string, number> = {};

  for (const q of QUERIES) {
    try {
      const res = (await customer.query(q.gaql(campaign.campaignId))) as Array<Record<string, unknown>>;
      for (const [i, raw] of res.entries()) {
        collected.push({
          kind: q.kind,
          ref: refOf(raw) ?? `${q.kind}:${i}`,
          payload: raw as Record<string, unknown>,
        });
      }
      byKind[q.kind] = res.length;
    } catch (err) {
      // A campaign without a given resource is normal; record it and move on
      // rather than aborting the whole sync for one unavailable surface.
      errors[q.kind] = errMessage(err);
      byKind[q.kind] = 0;
    }
  }

  // Hour-of-day spend: the only way to price the ad-schedule question instead
  // of asserting it. Aggregated into one 24-slot row per campaign rather than a
  // time series — we need "how much do we spend while shut", not history.
  try {
    const HOURLY_DAYS = 7;
    const to = new Date();
    to.setUTCDate(to.getUTCDate() - 1);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (HOURLY_DAYS - 1));
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const hourRows = (await customer.query(`
      SELECT segments.hour, metrics.cost_micros, metrics.clicks, metrics.impressions
      FROM campaign
      WHERE campaign.id = ${campaign.campaignId}
        AND segments.date BETWEEN '${ymd(from)}' AND '${ymd(to)}'
    `)) as Array<Record<string, unknown>>;

    const parsed = hourRows.map((r) => {
      const seg = (r.segments ?? {}) as Record<string, unknown>;
      const m = (r.metrics ?? {}) as Record<string, unknown>;
      return {
        hour: Number(seg.hour ?? -1),
        costMyr: Number(m.cost_micros ?? 0) / 1_000_000,
        clicks: Number(m.clicks ?? 0),
        impressions: Number(m.impressions ?? 0),
      };
    });
    const profile = hourProfile(parsed, HOURLY_DAYS);
    collected.push({
      kind: "hour_profile",
      ref: `${ymd(from)}..${ymd(to)}`,
      payload: { windowDays: HOURLY_DAYS, from: ymd(from), to: ymd(to), deadHours: DEAD_HOURS, ...profile },
    });
    byKind.hour_profile = 1;
  } catch (err) {
    errors.hour_profile = errMessage(err);
    byKind.hour_profile = 0;
  }

  for (const row of collected) {
    await prisma.adsCampaignCreative.upsert({
      where: { campaignId_kind_ref: { campaignId: campaignPk, kind: row.kind, ref: row.ref } },
      update: { payload: row.payload as never, syncedAt: new Date() },
      create: {
        id: randomUUID(),
        campaignId: campaignPk,
        kind: row.kind,
        ref: row.ref,
        payload: row.payload as never,
      },
    });
  }

  return { rows: collected.length, byKind, errors };
}

/** Best-effort stable identity for a returned row, whatever shape it has. */
function refOf(raw: Record<string, unknown>): string | null {
  const nested = (obj: unknown, path: string[]): unknown =>
    path.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
  const candidates = [
    nested(raw, ["ad_group_ad", "ad", "resource_name"]),
    nested(raw, ["smart_campaign_setting", "resource_name"]),
    nested(raw, ["campaign_criterion", "resource_name"]),
    nested(raw, ["campaign_asset", "resource_name"]),
  ];
  const hit = candidates.find((c) => typeof c === "string" && c.length > 0);
  return (hit as string) ?? null;
}

/** Sync every enabled campaign. Never throws — one bad campaign can't kill the run. */
export async function syncAllAdCreative(
  campaignPks: string[],
): Promise<Record<string, { rows: number; byKind: Record<string, number>; errors: Record<string, string> }>> {
  const out: Record<string, { rows: number; byKind: Record<string, number>; errors: Record<string, string> }> = {};
  for (const pk of campaignPks) {
    try {
      out[pk] = await syncCampaignCreative(pk);
    } catch (err) {
      out[pk] = { rows: 0, byKind: {}, errors: { fatal: errMessage(err) } };
    }
  }
  return out;
}
