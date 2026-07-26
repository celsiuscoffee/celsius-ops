/**
 * Consolidation of a campaign's negative keyword themes toward broad ROOTS.
 *
 * Why (2026-07-21): all three campaigns hit the 25-negative slot cap with
 * spend on junk still un-excluded. The slots were burned on literal
 * near-duplicates ("kenangan coffee" + "kenangan coffee near me" = 2 slots),
 * so adding the root "kenangan" covers both in one slot AND pre-blocks future
 * variants.
 *
 * IMPORTANT (2026-07-23) — this module no longer REMOVES the literals a root
 * subsumes. The original version did, and it caused a live regression: the
 * literals "restaurants" / "restaurants near me" were removed in favour of the
 * root "restaurant", on the assumption that Google's fuzzy themes stem plural
 * → singular. They do not. Both plurals resumed spending the next day
 * (~RM12/day across Tamarind + Putrajaya) and nothing caught it.
 *
 * A root is an ADDITIVE bet: it may catch variants we haven't seen, but it is
 * never proof that an existing, demonstrably-working literal is redundant.
 * Being wrong about an add costs one slot; being wrong about a removal costs
 * real money, silently. Slot pressure is instead handled by value-ranked
 * eviction (`planSlotSwap` in verify-exclusions.ts), which drops the least
 * valuable negative rather than the one that merely looks redundant.
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { classifyTermIntent, exclusionPhrase, shouldAutoExclude } from "./term-rules";
import { randomUUID } from "crypto";

export type ExistingNegative = { searchTerm: string; criterionResource: string | null };
export type ConsolidationPlan = {
  addRoots: string[]; // broad roots to create (purely additive)
};

/**
 * Pure: given a campaign's applied negatives, plan the broad roots worth
 * adding alongside them. Never plans a removal — see the module note.
 */
export function planConsolidation(existing: ExistingNegative[]): ConsolidationPlan {
  const present = new Set(existing.map((e) => e.searchTerm.toLowerCase()));
  const rootsNeeded = new Set<string>();

  for (const e of existing) {
    const term = e.searchTerm.toLowerCase();
    const intent = classifyTermIntent(term);
    if (!shouldAutoExclude(intent)) continue;
    const phrase = exclusionPhrase(term, intent);
    if (phrase === term) continue; // already a root (or own-brand/other)
    rootsNeeded.add(phrase);
  }

  return { addRoots: [...rootsNeeded].filter((r) => !present.has(r)) };
}

/** IO: remove one negative from Google and mark its ledger row superseded. */
export async function removeCampaignNegative(
  customerId: string,
  criterionResource: string,
  ledgerId: string,
): Promise<boolean> {
  try {
    const customer = getCustomer(customerId);
    await customer.campaignCriteria.remove([criterionResource]);
    await prisma.adsTermExclusion.update({
      where: { id: ledgerId },
      data: { status: "superseded", error: null },
    });
    return true;
  } catch (err) {
    console.error(`[negatives] remove failed for ${criterionResource}:`, (err as Error).message);
    return false;
  }
}

/** IO: add the planned roots for one campaign, within the free slots available. */
export async function consolidateCampaignNegatives(
  campaignPk: string,
  freeSlots: number,
): Promise<{ added: number; skipped: number; error?: string }> {
  if (freeSlots <= 0) return { added: 0, skipped: 0 };

  const campaign = await prisma.adsCampaign.findUnique({
    where: { id: campaignPk },
    include: { account: { select: { customerId: true } } },
  });
  if (!campaign) return { added: 0, skipped: 0, error: "Campaign not found" };

  const applied = await prisma.adsTermExclusion.findMany({
    where: { campaignId: campaignPk, status: "applied" },
    select: { searchTerm: true, criterionResource: true },
  });
  const plan = planConsolidation(applied);
  if (plan.addRoots.length === 0) return { added: 0, skipped: 0 }; // already consolidated

  const customerId = campaign.account.customerId.replace(/-/g, "");
  const customer = getCustomer(customerId);
  const roots = plan.addRoots.slice(0, freeSlots);
  let added = 0;

  for (const root of roots) {
    try {
      const res = (await customer.campaignCriteria.create([
        {
          campaign: `customers/${customerId}/campaigns/${campaign.campaignId}`,
          negative: true,
          keyword_theme: { free_form_keyword_theme: root },
        },
      ])) as { results?: Array<{ resource_name?: string }> };
      await prisma.adsTermExclusion.upsert({
        where: { campaignId_searchTerm: { campaignId: campaignPk, searchTerm: root } },
        update: {
          status: "applied",
          criterionResource: res.results?.[0]?.resource_name ?? null,
          error: null,
          decidedBy: "ads-autopilot",
          decidedAt: new Date(),
          appliedAt: new Date(),
        },
        create: {
          id: randomUUID(),
          campaignId: campaignPk,
          searchTerm: root,
          status: "applied",
          reason: "autopilot: broad negative root (additive; literals retained)",
          criterionResource: res.results?.[0]?.resource_name ?? null,
          decidedBy: "ads-autopilot",
          appliedAt: new Date(),
        },
      });
      added++;
    } catch (err) {
      console.error(`[consolidate] add root failed for "${root}":`, (err as Error).message);
    }
  }

  return { added, skipped: plan.addRoots.length - roots.length };
}
