/**
 * Sync per-campaign, per-conversion-action daily breakdown.
 *
 * Different from sync-metrics (which stores aggregate conversions as a
 * single number) — this splits conversions by category, so F&B outlets
 * can see how many were direction requests vs phone calls vs website
 * visits etc.
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { randomUUID } from "crypto";

// Maps Google's numeric ConversionActionCategory enum to readable strings.
// ref: https://developers.google.com/google-ads/api/reference/rpc/latest/ConversionActionCategoryEnum.ConversionActionCategory
const CATEGORY_MAP: Record<number | string, string> = {
  0: "UNSPECIFIED",
  1: "UNKNOWN",
  2: "DEFAULT",
  3: "PAGE_VIEW",
  4: "PURCHASE",
  5: "SIGNUP",
  6: "LEAD",
  7: "DOWNLOAD",
  8: "ADD_TO_CART",
  9: "BEGIN_CHECKOUT",
  10: "SUBSCRIBE_PAID",
  11: "PHONE_CALL_LEAD",
  12: "IMPORTED_LEAD",
  13: "SUBMIT_LEAD_FORM",
  14: "BOOK_APPOINTMENT",
  15: "REQUEST_QUOTE",
  16: "GET_DIRECTIONS",
  17: "OUTBOUND_CLICK",
  18: "CONTACT",
  19: "ENGAGEMENT",
  20: "STORE_VISIT",
  21: "STORE_SALE",
  22: "QUALIFIED_LEAD",
  23: "CONVERTED_LEAD",
};

function categoryName(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return CATEGORY_MAP[v] ?? String(v);
  return "UNKNOWN";
}

export async function syncConversions(
  accountId: string,
  customerId: string,
  fromDate: string,
  toDate: string,
): Promise<{ rows: number }> {
  const customer = getCustomer(customerId);

  // GAQL segmented by conversion_action — returns one row per (date, campaign, action).
  const rows = await customer.query(`
    SELECT
      segments.date,
      campaign.id,
      segments.conversion_action,
      segments.conversion_action_name,
      segments.conversion_action_category,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '${fromDate}' AND '${toDate}'
      AND campaign.status != 'REMOVED'
  `);

  // Resolve our campaign pk per Google campaign id
  const campaigns = await prisma.adsCampaign.findMany({
    where: { accountId },
    select: { id: true, campaignId: true },
  });
  const campaignMap = new Map(campaigns.map((c) => [c.campaignId, c.id]));

  let written = 0;
  for (const row of rows) {
    const date = row.segments?.date;
    const gCampaignId = row.campaign?.id != null ? String(row.campaign.id) : null;
    const actionResource = row.segments?.conversion_action; // e.g. "customers/123/conversionActions/456"
    if (!date || !gCampaignId || !actionResource) continue;

    const campaignPk = campaignMap.get(gCampaignId);
    if (!campaignPk) continue;

    const actionId = String(actionResource).split("/").pop() ?? String(actionResource);
    const actionName = (row.segments?.conversion_action_name as string | undefined) ?? actionId;
    const category = categoryName(row.segments?.conversion_action_category);
    const conv = Number(row.metrics?.conversions ?? 0);
    const convValue = Number(row.metrics?.conversions_value ?? 0);

    const dateObj = new Date(date + "T00:00:00Z");

    await prisma.adsConversionDaily.upsert({
      where: {
        date_campaignId_conversionActionId: {
          date: dateObj,
          campaignId: campaignPk,
          conversionActionId: actionId,
        },
      },
      update: {
        conversionActionName: actionName,
        conversionCategory: category,
        conversions: conv,
        conversionsValue: convValue,
        syncedAt: new Date(),
      },
      create: {
        id: randomUUID(),
        date: dateObj,
        accountId,
        campaignId: campaignPk,
        conversionActionId: actionId,
        conversionActionName: actionName,
        conversionCategory: category,
        conversions: conv,
        conversionsValue: convValue,
      },
    });
    written++;
  }

  return { rows: written };
}
