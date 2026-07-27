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

// Batch size for the set-based upsert below. A 3-day window can carry a few
// thousand term-rows; the old one-upsert-per-row loop (thousands of pool
// round-trips) exhausted the connection pool / maxDuration after the FIRST
// account every night — only Putrajaya ever synced and the sync-log row was
// left stuck in RUNNING.
const BATCH = 500;

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

  // Dedupe on the conflict key — ON CONFLICT DO UPDATE errors if one statement
  // touches the same row twice.
  type Rec = { date: string; campaignId: string; term: string; impressions: string; clicks: string; cost: string };
  const byKey = new Map<string, Rec>();
  for (const row of rows) {
    const date = row.segments?.date;
    const gCampaignId = row.campaign?.id != null ? String(row.campaign.id) : null;
    const term = (row.smart_campaign_search_term_view as { search_term?: string } | undefined)?.search_term?.trim();
    if (!date || !gCampaignId || !term) continue;
    const campaignPk = campaignMap.get(gCampaignId);
    if (!campaignPk) continue; // unknown campaign — next sync will include it
    const m = row.metrics ?? {};
    byKey.set(`${date}|${campaignPk}|${term}`, {
      date,
      campaignId: campaignPk,
      term,
      impressions: String(m.impressions ?? 0),
      clicks: String(m.clicks ?? 0),
      cost: String(m.cost_micros ?? 0),
    });
  }

  const recs = [...byKey.values()];
  for (let i = 0; i < recs.length; i += BATCH) {
    const chunk = recs.slice(i, i + BATCH);
    await prisma.$executeRaw`
      INSERT INTO ads_search_term_daily
        (id, date, campaign_id, search_term, impressions, clicks, cost_micros, synced_at)
      SELECT gen_random_uuid()::text, u.date, u.campaign_id, u.search_term,
             u.impressions, u.clicks, u.cost_micros, now()
      FROM unnest(
        ${chunk.map((r) => r.date)}::date[],
        ${chunk.map((r) => r.campaignId)}::text[],
        ${chunk.map((r) => r.term)}::text[],
        ${chunk.map((r) => r.impressions)}::bigint[],
        ${chunk.map((r) => r.clicks)}::bigint[],
        ${chunk.map((r) => r.cost)}::bigint[]
      ) AS u(date, campaign_id, search_term, impressions, clicks, cost_micros)
      ON CONFLICT (date, campaign_id, search_term) DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks      = EXCLUDED.clicks,
        cost_micros = EXCLUDED.cost_micros,
        synced_at   = now()
    `;
  }

  return { rows: recs.length };
}
