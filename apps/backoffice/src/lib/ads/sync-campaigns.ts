/**
 * Sync campaigns for a given Ads account.
 *
 * Upserts into ads_campaign. Preserves existing outlet_id link
 * (that's set manually via /ads/settings and should not be overwritten
 * during automatic sync).
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { randomUUID } from "crypto";

export async function syncCampaigns(accountId: string, customerId: string): Promise<{ inserted: number; updated: number }> {
  const customer = getCustomer(customerId);

  const rows = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros
    FROM campaign
    WHERE campaign.status != 'REMOVED'
  `);

  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    const c = row.campaign as Record<string, unknown> | undefined;
    if (!c?.id) continue;
    const campaignId = String(c.id);

    const existing = await prisma.adsCampaign.findUnique({
      where: { accountId_campaignId: { accountId, campaignId } },
    });

    const startDate = c.start_date as string | undefined;
    const endDate = c.end_date as string | undefined;
    const budgetRow = row.campaign_budget as { amount_micros?: number | string } | undefined;

    const data = {
      name: (c.name as string) ?? `Campaign ${campaignId}`,
      status: String(c.status ?? "UNKNOWN"),
      advertisingChannelType: String(c.advertising_channel_type ?? "UNKNOWN"),
      startDate: startDate ? new Date(startDate + "T00:00:00Z") : null,
      endDate: endDate && endDate !== "2037-12-30" ? new Date(endDate + "T00:00:00Z") : null,
      dailyBudgetMicros: budgetRow?.amount_micros != null ? BigInt(budgetRow.amount_micros) : null,
    };

    if (existing) {
      // Never overwrite outletId — that's managed by the user.
      await prisma.adsCampaign.update({
        where: { id: existing.id },
        data,
      });
      updated++;
    } else {
      await prisma.adsCampaign.create({
        data: {
          id: randomUUID(),
          accountId,
          campaignId,
          ...data,
        },
      });
      inserted++;
    }
  }

  return { inserted, updated };
}
