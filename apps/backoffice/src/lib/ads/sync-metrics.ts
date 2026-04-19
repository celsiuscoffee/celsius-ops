/**
 * Sync daily metrics for an account.
 *
 * For a given date range:
 *   - Fetches per-campaign daily rows from GAQL.
 *   - Upserts each into ads_metric_daily.
 *   - Computes an account-level roll-up row (campaign_id = null) per date.
 *
 * Campaign records must already exist (call syncCampaigns first).
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { randomUUID } from "crypto";

export async function syncMetrics(
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
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_micros,
      metrics.average_cpc,
      metrics.ctr
    FROM campaign
    WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
      AND campaign.status != 'REMOVED'
  `);

  // Index campaign table once so we can resolve campaignId → row id
  const campaigns = await prisma.adsCampaign.findMany({
    where: { accountId },
    select: { id: true, campaignId: true },
  });
  const campaignMap = new Map(campaigns.map((c) => [c.campaignId, c.id]));

  // Aggregate per-day account totals while we iterate.
  const accountTotals = new Map<string, {
    impressions: bigint;
    clicks: bigint;
    conversions: number;
    conversionsValue: number;
    costMicros: bigint;
  }>();

  let written = 0;

  for (const row of rows) {
    const date = row.segments?.date;
    const gCampaignId = row.campaign?.id != null ? String(row.campaign.id) : null;
    if (!date || !gCampaignId) continue;

    const campaignPk = campaignMap.get(gCampaignId);
    if (!campaignPk) continue; // unknown campaign — skip, next sync will include

    const m = row.metrics ?? {};
    const impressions = BigInt(m.impressions ?? 0);
    const clicks = BigInt(m.clicks ?? 0);
    const conversions = Number(m.conversions ?? 0);
    const conversionsValue = Number(m.conversions_value ?? 0);
    const costMicros = BigInt(m.cost_micros ?? 0);
    const avgCpcMicros = m.average_cpc != null ? BigInt(Math.round(Number(m.average_cpc))) : null;
    const ctr = m.ctr != null ? Number(m.ctr) : null;

    const dateObj = new Date(date + "T00:00:00Z");

    // Upsert per-campaign row
    await prisma.adsMetricDaily.upsert({
      where: {
        date_accountId_campaignId: {
          date: dateObj,
          accountId,
          campaignId: campaignPk,
        },
      },
      update: {
        impressions,
        clicks,
        conversions,
        conversionsValue,
        costMicros,
        avgCpcMicros,
        ctr,
        syncedAt: new Date(),
      },
      create: {
        id: randomUUID(),
        date: dateObj,
        accountId,
        campaignId: campaignPk,
        impressions,
        clicks,
        conversions,
        conversionsValue,
        costMicros,
        avgCpcMicros,
        ctr,
      },
    });
    written++;

    // Accumulate account total
    const key = date;
    const current = accountTotals.get(key) ?? {
      impressions: BigInt(0),
      clicks: BigInt(0),
      conversions: 0,
      conversionsValue: 0,
      costMicros: BigInt(0),
    };
    current.impressions += impressions;
    current.clicks += clicks;
    current.conversions += conversions;
    current.conversionsValue += conversionsValue;
    current.costMicros += costMicros;
    accountTotals.set(key, current);
  }

  // Write account-level rows (campaign_id = null)
  for (const [date, totals] of accountTotals.entries()) {
    const dateObj = new Date(date + "T00:00:00Z");
    const ctr = totals.impressions > BigInt(0) ? Number(totals.clicks) / Number(totals.impressions) : 0;

    // Prisma @@unique with nullable columns is tricky — use a raw upsert pattern.
    const existing = await prisma.adsMetricDaily.findFirst({
      where: { date: dateObj, accountId, campaignId: null },
    });

    if (existing) {
      await prisma.adsMetricDaily.update({
        where: { id: existing.id },
        data: {
          impressions: totals.impressions,
          clicks: totals.clicks,
          conversions: totals.conversions,
          conversionsValue: totals.conversionsValue,
          costMicros: totals.costMicros,
          ctr,
          syncedAt: new Date(),
        },
      });
    } else {
      await prisma.adsMetricDaily.create({
        data: {
          id: randomUUID(),
          date: dateObj,
          accountId,
          campaignId: null,
          impressions: totals.impressions,
          clicks: totals.clicks,
          conversions: totals.conversions,
          conversionsValue: totals.conversionsValue,
          costMicros: totals.costMicros,
          ctr,
        },
      });
    }
    written++;
  }

  return { rows: written };
}
