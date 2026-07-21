/**
 * One-time (self-expiring, idempotent) consolidation of a campaign's negative
 * keyword themes from LITERAL search terms to broad ROOTS.
 *
 * Why (2026-07-21): all three campaigns hit the 25-negative slot cap with
 * spend on junk still un-excluded. The slots were burned on literal
 * near-duplicates ("kenangan coffee" + "kenangan coffee near me" = 2 slots).
 * Google negative themes are fuzzy, so the root "kenangan" covers both in one
 * slot AND pre-blocks future variants. Consolidating frees slots so the
 * remaining junk can finally be excluded.
 *
 * Runs inside the nightly autopilot (armed mode). Idempotent: once a campaign
 * has no literal that collapses into a distinct root, it plans nothing.
 * Removes superseded literals FIRST (frees slots), then adds the roots, so the
 * campaign never exceeds the cap mid-run. Every change is ledgered.
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { classifyTermIntent, exclusionPhrase, shouldAutoExclude } from "./term-rules";
import { randomUUID } from "crypto";

export type ExistingNegative = { searchTerm: string; criterionResource: string | null };
export type ConsolidationPlan = {
  addRoots: string[];        // broad roots to create
  removeLiterals: ExistingNegative[]; // literals subsumed by a root, to remove
};

/**
 * Pure: given a campaign's applied negatives, plan the literal→root swap.
 * A literal is removed only when its root differs from itself AND we can add
 * that root; own-brand / unrecognised terms (root === self) are left as-is.
 * Roots already present are not re-added.
 */
export function planConsolidation(existing: ExistingNegative[]): ConsolidationPlan {
  const present = new Set(existing.map((e) => e.searchTerm.toLowerCase()));
  const rootsNeeded = new Set<string>();
  const removeLiterals: ExistingNegative[] = [];

  for (const e of existing) {
    const term = e.searchTerm.toLowerCase();
    const intent = classifyTermIntent(term);
    if (!shouldAutoExclude(intent)) continue;
    const phrase = exclusionPhrase(term, intent);
    if (phrase === term) continue; // already a root (or own-brand/other) — keep
    rootsNeeded.add(phrase);
    removeLiterals.push(e);
  }

  const addRoots = [...rootsNeeded].filter((r) => !present.has(r));
  return { addRoots, removeLiterals };
}

/** IO: apply the plan for one campaign against Google Ads + the ledger. */
export async function consolidateCampaignNegatives(
  campaignPk: string,
): Promise<{ added: number; removed: number; error?: string }> {
  const campaign = await prisma.adsCampaign.findUnique({
    where: { id: campaignPk },
    include: { account: { select: { customerId: true } } },
  });
  if (!campaign) return { added: 0, removed: 0, error: "Campaign not found" };

  const applied = await prisma.adsTermExclusion.findMany({
    where: { campaignId: campaignPk, status: "applied" },
    select: { id: true, searchTerm: true, criterionResource: true },
  });
  const plan = planConsolidation(
    applied.map((a) => ({ searchTerm: a.searchTerm, criterionResource: a.criterionResource })),
  );
  if (plan.addRoots.length === 0 && plan.removeLiterals.length === 0) {
    return { added: 0, removed: 0 }; // already consolidated — no-op
  }

  const customerId = campaign.account.customerId.replace(/-/g, "");
  const customer = getCustomer(customerId);
  const idByTerm = new Map(applied.map((a) => [a.searchTerm.toLowerCase(), a.id]));
  let removed = 0;
  let added = 0;

  // 1) Remove superseded literals FIRST to free slots.
  for (const lit of plan.removeLiterals) {
    if (!lit.criterionResource) continue; // can't remove without the resource name
    try {
      await customer.campaignCriteria.remove([lit.criterionResource]);
      const id = idByTerm.get(lit.searchTerm.toLowerCase());
      if (id) {
        await prisma.adsTermExclusion.update({
          where: { id },
          data: { status: "superseded", error: null },
        });
      }
      removed++;
    } catch (err) {
      // Leave the ledger row 'applied' if the remove failed; the root add below
      // still improves coverage. Don't abort the whole campaign.
      console.error(`[consolidate] remove failed for "${lit.searchTerm}":`, (err as Error).message);
    }
  }

  // 2) Add the broad roots.
  for (const root of plan.addRoots) {
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
        update: { status: "applied", criterionResource: res.results?.[0]?.resource_name ?? null, error: null, decidedBy: "ads-autopilot", decidedAt: new Date(), appliedAt: new Date() },
        create: {
          id: randomUUID(),
          campaignId: campaignPk,
          searchTerm: root,
          status: "applied",
          reason: "autopilot: consolidated broad negative root (2026-07-21)",
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

  return { added, removed };
}
