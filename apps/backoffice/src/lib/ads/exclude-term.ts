/**
 * Approval-gated search-term exclusion for Smart campaigns.
 *
 * Applying an exclusion adds a NEGATIVE free-form keyword theme to the
 * campaign — Google stops matching the term, and its spend redistributes
 * within the same campaign budget. This module is only ever invoked from the
 * Paid x Organic panel's approve button (never from a cron or automatically),
 * and every decision — applied, failed, or rejected — lands in the
 * ads_term_exclusion ledger.
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { randomUUID } from "crypto";

export type ExclusionDecision = {
  campaignId: string; // ads_campaign.id (our PK)
  searchTerm: string;
  decidedBy: string;
  estMonthlySavingMyr?: number | null;
  reason?: string | null; // organic evidence shown at decision time
};

async function upsertLedger(
  d: ExclusionDecision,
  fields: { status: string; criterionResource?: string | null; error?: string | null; appliedAt?: Date | null },
) {
  const term = d.searchTerm.toLowerCase();
  return prisma.adsTermExclusion.upsert({
    where: { campaignId_searchTerm: { campaignId: d.campaignId, searchTerm: term } },
    update: {
      status: fields.status,
      criterionResource: fields.criterionResource ?? undefined,
      error: fields.error ?? null,
      estMonthlySavingMyr: d.estMonthlySavingMyr ?? undefined,
      reason: d.reason ?? undefined,
      decidedBy: d.decidedBy,
      decidedAt: new Date(),
      appliedAt: fields.appliedAt ?? undefined,
    },
    create: {
      id: randomUUID(),
      campaignId: d.campaignId,
      searchTerm: term,
      status: fields.status,
      criterionResource: fields.criterionResource ?? null,
      error: fields.error ?? null,
      estMonthlySavingMyr: d.estMonthlySavingMyr ?? null,
      reason: d.reason ?? null,
      decidedBy: d.decidedBy,
      appliedAt: fields.appliedAt ?? null,
    },
  });
}

/** Approve: write the negative keyword theme to Google Ads, then record it. */
export async function applyTermExclusion(d: ExclusionDecision): Promise<{ ok: boolean; error?: string }> {
  const campaign = await prisma.adsCampaign.findUnique({
    where: { id: d.campaignId },
    include: { account: { select: { customerId: true } } },
  });
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const customerId = campaign.account.customerId.replace(/-/g, "");
  try {
    const customer = getCustomer(customerId);
    const res = (await customer.campaignCriteria.create([
      {
        campaign: `customers/${customerId}/campaigns/${campaign.campaignId}`,
        negative: true,
        keyword_theme: { free_form_keyword_theme: d.searchTerm.toLowerCase() },
      },
    ])) as { results?: Array<{ resource_name?: string }> };

    await upsertLedger(d, {
      status: "applied",
      criterionResource: res.results?.[0]?.resource_name ?? null,
      appliedAt: new Date(),
    });
    return { ok: true };
  } catch (err) {
    const e = err as { errors?: Array<{ message?: string }>; message?: string };
    const message =
      e?.errors?.map((x) => x.message).filter(Boolean).join(" | ") || e?.message || String(err);
    await upsertLedger(d, { status: "failed", error: message.slice(0, 1000) });
    return { ok: false, error: message };
  }
}

/** Dismiss: record the human's "no" so the suggestion stops resurfacing. */
export async function rejectTermExclusion(d: ExclusionDecision) {
  await upsertLedger(d, { status: "rejected" });
}
