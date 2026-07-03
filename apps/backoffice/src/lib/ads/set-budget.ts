/**
 * Approval-gated daily-budget change for a Smart campaign.
 *
 * The optimizer only ever *recommends* a cut — reclaim spend to redeploy to
 * other marketing. Applying one is a deliberate human click on the Optimizer
 * page (never a cron, never automatic), and every decision — applied, failed,
 * or rejected — lands in the ads_budget_change ledger with the previous amount
 * so a cut can be undone.
 *
 * A Smart campaign's budget is a CampaignBudget resource shared via the
 * campaign. We read its resource_name over GAQL, then update amount_micros.
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { randomUUID } from "crypto";

const MYR_TO_MICROS = 1_000_000;

export type BudgetDecision = {
  campaignId: string; // ads_campaign.id (our PK)
  newDailyMyr: number;
  decidedBy: string;
  monthlySavingMyr?: number | null;
  projConvLostPerMonth?: number | null;
  reason?: string | null; // efficiency evidence shown at decision time
};

async function insertLedger(
  d: BudgetDecision,
  fields: {
    status: string;
    prevDailyMicros: bigint | null;
    newDailyMicros: bigint;
    budgetResource?: string | null;
    error?: string | null;
    appliedAt?: Date | null;
  },
) {
  return prisma.adsBudgetChange.create({
    data: {
      id: randomUUID(),
      campaignId: d.campaignId,
      status: fields.status,
      prevDailyMicros: fields.prevDailyMicros ?? null,
      newDailyMicros: fields.newDailyMicros,
      monthlySavingMyr: d.monthlySavingMyr ?? null,
      projConvLostPerMonth: d.projConvLostPerMonth ?? null,
      reason: d.reason ?? null,
      budgetResource: fields.budgetResource ?? null,
      error: fields.error ?? null,
      decidedBy: d.decidedBy,
      appliedAt: fields.appliedAt ?? null,
    },
  });
}

/** Approve: set the campaign's daily budget in Google Ads, then record it. */
export async function applyBudgetChange(
  d: BudgetDecision,
): Promise<{ ok: boolean; error?: string }> {
  const campaign = await prisma.adsCampaign.findUnique({
    where: { id: d.campaignId },
    include: { account: { select: { customerId: true } } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const newMicros = BigInt(Math.round(d.newDailyMyr * MYR_TO_MICROS));
  if (newMicros <= BigInt(0)) return { ok: false, error: "New daily budget must be > 0" };

  const prevMicros = campaign.dailyBudgetMicros ?? null;
  const customerId = campaign.account.customerId.replace(/-/g, "");

  try {
    const customer = getCustomer(customerId);

    // Find the CampaignBudget resource this campaign spends against.
    const rows = (await customer.query(`
      SELECT campaign_budget.resource_name, campaign_budget.amount_micros
      FROM campaign
      WHERE campaign.id = ${campaign.campaignId}
      LIMIT 1
    `)) as Array<{ campaign_budget?: { resource_name?: string } }>;

    const budgetResource = rows?.[0]?.campaign_budget?.resource_name;
    if (!budgetResource) {
      const msg = "Campaign budget resource not found";
      await insertLedger(d, { status: "failed", prevDailyMicros: prevMicros, newDailyMicros: newMicros, error: msg });
      return { ok: false, error: msg };
    }

    await customer.campaignBudgets.update([
      { resource_name: budgetResource, amount_micros: Number(newMicros) },
    ]);

    // Mirror the new amount locally so the report reflects it before the next sync.
    await prisma.adsCampaign.update({
      where: { id: campaign.id },
      data: { dailyBudgetMicros: newMicros },
    });

    await insertLedger(d, {
      status: "applied",
      prevDailyMicros: prevMicros,
      newDailyMicros: newMicros,
      budgetResource,
      appliedAt: new Date(),
    });
    return { ok: true };
  } catch (err) {
    const e = err as { errors?: Array<{ message?: string }>; message?: string };
    const message =
      e?.errors?.map((x) => x.message).filter(Boolean).join(" | ") || e?.message || String(err);
    await insertLedger(d, {
      status: "failed",
      prevDailyMicros: prevMicros,
      newDailyMicros: newMicros,
      error: message.slice(0, 1000),
    });
    return { ok: false, error: message };
  }
}

/** Dismiss: record the human's "no" so the suggestion is auditable. */
export async function rejectBudgetChange(d: BudgetDecision) {
  const newMicros = BigInt(Math.round(d.newDailyMyr * MYR_TO_MICROS));
  const campaign = await prisma.adsCampaign.findUnique({
    where: { id: d.campaignId },
    select: { dailyBudgetMicros: true },
  });
  await insertLedger(d, {
    status: "rejected",
    prevDailyMicros: campaign?.dailyBudgetMicros ?? null,
    newDailyMicros: newMicros,
  });
}
