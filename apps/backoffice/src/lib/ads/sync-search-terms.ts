/**
 * Sync the actual search terms Smart campaigns matched, with per-day spend.
 *
 * Smart campaigns carry no keyword criteria, so the standard keyword_view
 * (sync-keywords / ads_keyword_metric) is empty for them. The term-level
 * truth lives in smart_campaign_search_term_view — this is the data the
 * Paid×Organic consolidation joins against geogrid ranks.
 *
 * Campaign records must already exist (call syncCampaigns first).
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { randomUUID } from "crypto";

export async function syncSearchTerms(
  accountId: string,
  customerId: string,
  fromDate: string, // YYYY-MM-DD
  toDate: string,   // YYYY-MM-DD (inclusive)
): Promise<{ rows: number }> {
  const customer = getCustomer(customerId);

  const rows = await customer.query(`
    SELECT
      segments.date,
      campaign.id,
      smart_campaign_search_term_view.search_term,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM smart_campaign_search_term_view
    WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
  `);

  const campaigns = await prisma.adsCampaign.findMany({
    where: { accountId },
    select: { id: true, campaignId: true },
  });
  const campaignMap = new Map(campaigns.map((c) => [c.campaignId, c.id]));

  let written = 0;
  for (const row of rows) {
    const date = row.segments?.date;
    const gCampaignId = row.campaign?.id != null ? String(row.campaign.id) : null;
    const term = (row.smart_campaign_search_term_view as { search_term?: string } | undefined)?.search_term?.trim();
    if (!date || !gCampaignId || !term) continue;

    const campaignPk = campaignMap.get(gCampaignId);
    if (!campaignPk) continue; // unknown campaign — next sync will include it

    const m = row.metrics ?? {};
    const dateObj = new Date(date + "T00:00:00Z");

    await prisma.adsSearchTermDaily.upsert({
      where: {
        date_campaignId_searchTerm: { date: dateObj, campaignId: campaignPk, searchTerm: term },
      },
      update: {
        impressions: BigInt(m.impressions ?? 0),
        clicks: BigInt(m.clicks ?? 0),
        costMicros: BigInt(m.cost_micros ?? 0),
        syncedAt: new Date(),
      },
      create: {
        id: randomUUID(),
        date: dateObj,
        campaignId: campaignPk,
        searchTerm: term,
        impressions: BigInt(m.impressions ?? 0),
        clicks: BigInt(m.clicks ?? 0),
        costMicros: BigInt(m.cost_micros ?? 0),
      },
    });
    written++;
  }

  return { rows: written };
}
