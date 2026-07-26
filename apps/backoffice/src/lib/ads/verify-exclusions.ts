/**
 * Post-apply verification for negative keyword themes — "did the exclusion
 * actually stop the spend?"
 *
 * Why this exists (2026-07-23 regression): the Jul 21 root consolidation
 * removed the literal negatives "restaurants" / "restaurants near me" and
 * replaced them with the broad root "restaurant", on the assumption that
 * Google's fuzzy themes stem plural → singular. They do NOT. Spend on both
 * plurals resumed the next day (RM24 in two days across Tamarind + Putrajaya)
 * and nothing noticed, because the autopilot applied exclusions and never
 * looked again.
 *
 * The fix is empirical rather than another guess about Google's matcher: watch
 * every applied negative, and if a term it should have blocked is STILL being
 * paid for after a short grace period, treat that as a LEAK and re-exclude the
 * offending literal term in its own right. Any future matching surprise
 * (plurals, transliterations, accents) self-corrects the same way.
 */

export type AppliedNegative = {
  campaignId: string;
  searchTerm: string; // the negative theme as written to Google (root or literal)
  appliedAt: Date;
};

export type TermSpendDay = {
  campaignId: string;
  searchTerm: string;
  date: Date;
  costMyr: number;
};

export type Leak = {
  campaignId: string;
  negative: string; // the negative that should have covered it
  leakTerm: string; // the literal query still being paid for
  costMyr: number; // spend strictly after the grace period
  days: number; // distinct days of leaked spend observed
};

// Google needs a little time to apply a theme; spend inside this window after
// appliedAt is propagation, not a leak.
export const LEAK_GRACE_DAYS = 2;
// Below this, re-spending a scarce negative slot isn't worth it.
export const LEAK_MIN_COST_MYR = 1;

const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Pure: find negatives that are not actually blocking.
 *
 * A spend row is "covered" by a negative when the search term contains the
 * negative phrase — that is exactly the coverage the root strategy assumes, so
 * it is exactly the assumption worth testing. Spend on a term that is itself
 * already an applied negative is not a leak (it is its own standing decision).
 */
export function findLeaks(
  negatives: AppliedNegative[],
  spend: TermSpendDay[],
  opts: { graceDays?: number; minCostMyr?: number } = {},
): Leak[] {
  const graceDays = opts.graceDays ?? LEAK_GRACE_DAYS;
  const minCost = opts.minCostMyr ?? LEAK_MIN_COST_MYR;

  // Negatives per campaign, longest first: attribute a leak to the most
  // specific negative that should have caught it.
  const byCampaign = new Map<string, AppliedNegative[]>();
  for (const n of negatives) {
    const list = byCampaign.get(n.campaignId) ?? [];
    list.push(n);
    byCampaign.set(n.campaignId, list);
  }
  for (const list of byCampaign.values()) list.sort((a, b) => b.searchTerm.length - a.searchTerm.length);

  const selfNegative = new Set(negatives.map((n) => `${n.campaignId} ${n.searchTerm.toLowerCase()}`));

  type Agg = { costMyr: number; days: Set<number>; negative: string };
  const leaks = new Map<string, Agg>();

  for (const s of spend) {
    if (s.costMyr <= 0) continue;
    const term = s.searchTerm.toLowerCase();
    if (selfNegative.has(`${s.campaignId} ${term}`)) continue; // already excluded in its own right

    const candidates = byCampaign.get(s.campaignId);
    if (!candidates) continue;
    const cover = candidates.find((n) => {
      const neg = n.searchTerm.toLowerCase();
      if (!term.includes(neg)) return false;
      // Only spend after the grace window counts as a leak.
      return startOfDay(s.date) > startOfDay(n.appliedAt) + graceDays * 86_400_000;
    });
    if (!cover) continue;

    const key = `${s.campaignId} ${term}`;
    const agg = leaks.get(key) ?? { costMyr: 0, days: new Set<number>(), negative: cover.searchTerm };
    agg.costMyr += s.costMyr;
    agg.days.add(startOfDay(s.date));
    leaks.set(key, agg);
  }

  return [...leaks.entries()]
    .map(([key, agg]) => {
      const sep = key.indexOf(" ");
      return {
        campaignId: key.slice(0, sep),
        negative: agg.negative,
        leakTerm: key.slice(sep + 1),
        costMyr: Math.round(agg.costMyr * 100) / 100,
        days: agg.days.size,
      };
    })
    .filter((l) => l.costMyr >= minCost)
    .sort((a, b) => b.costMyr - a.costMyr);
}

// ── Slot budgeting ──────────────────────────────────────────────────────────
// Negative slots are capped (~25/campaign). A leak repair is worth a slot only
// if it beats what is already sitting in one, so repairs can evict incumbents
// — but only when clearly more valuable, so the fleet doesn't churn.

export type Incumbent = {
  searchTerm: string;
  valueMyr: number; // measured monthly saving; seeds/unmeasured = 0
  criterionResource: string | null;
};
export type SlotCandidate = { searchTerm: string; valueMyr: number };
export type SlotPlan = {
  add: SlotCandidate[];
  evict: Incumbent[];
};

// A candidate must be worth this many times an incumbent to displace it.
export const EVICT_MARGIN = 1.5;

/**
 * Pure: score each negative by the junk spend it is demonstrably responsible
 * for — the measured cost of every term it covers over the window.
 *
 * Measure rather than trust the stored `estMonthlySavingMyr`: roots added by
 * consolidation carry no saving estimate at all, so ranking on the stored
 * field would score the single most valuable negative ("restaurant", RM42 of
 * covered junk) at zero and happily evict it. A negative that has never
 * matched paid traffic genuinely scores 0 and is the right thing to drop.
 */
export function scoreNegatives(
  negatives: { campaignId: string; searchTerm: string }[],
  spend: { campaignId: string; searchTerm: string; costMyr: number }[],
): Map<string, number> {
  const byCampaign = new Map<string, typeof spend>();
  for (const s of spend) {
    const list = byCampaign.get(s.campaignId) ?? [];
    list.push(s);
    byCampaign.set(s.campaignId, list);
  }
  const scores = new Map<string, number>();
  for (const n of negatives) {
    const neg = n.searchTerm.toLowerCase();
    let total = 0;
    for (const s of byCampaign.get(n.campaignId) ?? []) {
      if (s.searchTerm.toLowerCase().includes(neg)) total += s.costMyr;
    }
    scores.set(`${n.campaignId} ${neg}`, Math.round(total * 100) / 100);
  }
  return scores;
}

/**
 * Pure: fit candidates into the cap, evicting the least valuable incumbents
 * only when a candidate is decisively more valuable. Incumbents with no
 * removable resource name can't be evicted (we couldn't take them off Google).
 */
export function planSlotSwap(
  incumbents: Incumbent[],
  candidates: SlotCandidate[],
  cap: number,
  opts: { evictMargin?: number } = {},
): SlotPlan {
  const margin = opts.evictMargin ?? EVICT_MARGIN;
  const add: SlotCandidate[] = [];
  const evict: Incumbent[] = [];

  const ranked = [...candidates].sort((a, b) => b.valueMyr - a.valueMyr);
  // Cheapest first — the natural eviction order.
  const pool = [...incumbents]
    .filter((i) => i.criterionResource)
    .sort((a, b) => a.valueMyr - b.valueMyr);

  let free = Math.max(0, cap - incumbents.length);

  for (const c of ranked) {
    if (free > 0) {
      add.push(c);
      free--;
      continue;
    }
    const weakest = pool[0];
    if (!weakest || c.valueMyr < Math.max(weakest.valueMyr * margin, weakest.valueMyr)) break;
    pool.shift();
    evict.push(weakest);
    add.push(c);
  }

  return { add, evict };
}
