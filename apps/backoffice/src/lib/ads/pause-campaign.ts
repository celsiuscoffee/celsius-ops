/**
 * Campaign pause/enable for the autopilot's PAUSE PROBE (the one experiment a
 * ~RM100/day campaign can run that the till can actually read — see
 * autopilot.ts). Both mutations write a row to the ads_budget_change ledger
 * (prev = new = current budget when the budget itself is untouched) because
 * that ledger's reason prefixes ARE the autopilot's state-machine memory.
 */

import { prisma } from "@/lib/prisma";
import { enums } from "google-ads-api";
import { getCustomer } from "./client";
import { randomUUID } from "crypto";

// Local mirror of Google's CampaignStatus serialization used by sync-campaigns
// ("2" = ENABLED, "3" = PAUSED — numbers-as-strings).
export const LOCAL_STATUS_ENABLED = "2";
export const LOCAL_STATUS_PAUSED = "3";

async function setCampaignStatus(
  campaignPk: string,
  status: "PAUSED" | "ENABLED",
  reason: string,
  decidedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const campaign = await prisma.adsCampaign.findUnique({
    where: { id: campaignPk },
    include: { account: { select: { customerId: true } } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const customerId = campaign.account.customerId.replace(/-/g, "");
  try {
    const customer = getCustomer(customerId);
    await customer.campaigns.update([
      {
        resource_name: `customers/${customerId}/campaigns/${campaign.campaignId}`,
        status: status === "PAUSED" ? enums.CampaignStatus.PAUSED : enums.CampaignStatus.ENABLED,
      },
    ]);

    // Mirror locally so this run's later reads (and the UI before the nightly
    // sync) see the real state.
    await prisma.adsCampaign.update({
      where: { id: campaign.id },
      data: { status: status === "PAUSED" ? LOCAL_STATUS_PAUSED : LOCAL_STATUS_ENABLED },
    });

    await prisma.adsBudgetChange.create({
      data: {
        id: randomUUID(),
        campaignId: campaign.id,
        status: "applied",
        prevDailyMicros: campaign.dailyBudgetMicros ?? null,
        newDailyMicros: campaign.dailyBudgetMicros ?? BigInt(0),
        reason,
        decidedBy,
        appliedAt: new Date(),
      },
    });
    return { ok: true };
  } catch (err) {
    const e = err as { errors?: Array<{ message?: string }>; message?: string };
    const message =
      e?.errors?.map((x) => x.message).filter(Boolean).join(" | ") || e?.message || String(err);
    await prisma.adsBudgetChange.create({
      data: {
        id: randomUUID(),
        campaignId: campaign.id,
        status: "failed",
        prevDailyMicros: campaign.dailyBudgetMicros ?? null,
        newDailyMicros: campaign.dailyBudgetMicros ?? BigInt(0),
        reason,
        error: message.slice(0, 1000),
        decidedBy,
      },
    });
    return { ok: false, error: message };
  }
}

export const pauseCampaign = (campaignPk: string, reason: string, decidedBy: string) =>
  setCampaignStatus(campaignPk, "PAUSED", reason, decidedBy);

export const enableCampaign = (campaignPk: string, reason: string, decidedBy: string) =>
  setCampaignStatus(campaignPk, "ENABLED", reason, decidedBy);
