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

export type CreativeKind = "ad" | "setting" | "geo" | "schedule" | "asset";

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
      errors[q.kind] = (err as Error).message.slice(0, 300);
      byKind[q.kind] = 0;
    }
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
      out[pk] = { rows: 0, byKind: {}, errors: { fatal: (err as Error).message.slice(0, 300) } };
    }
  }
  return out;
}
