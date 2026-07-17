// Flex-head placement — spreads the outlet's "free" sunk/HQ heads (rovers who
// float across outlets + shared full-timers whose primary is elsewhere) across
// the week's open days so the extra hands land where the load is, one per day,
// WITHOUT stacking several onto the same day.
//
// Why this exists: the old rover pass let every rover independently pick the two
// busiest days, so two rovers piled onto the same Thursday (an 82.5h spike) while
// Saturday sat thin, and shared FT were never placed at all (idle sunk cost).
// This is a single demand-proportional pass: each head-day goes to the open day
// with the highest demand PER HEAD after placing it, so busy/under-covered days
// fill first and each placement lowers that day's priority for the next one.
//
// Pure + deterministic (no clock/random) so it's unit-testable; the generator
// computes each person's day BUDGET (by mode + weekly cap) and their FREE days,
// then this decides which days.

export type FlexPerson = {
  id: string;
  // Dates (YYYY-MM-DD) this person could work here: open days they're not already
  // rostered at another outlet and not on leave.
  freeDays: string[];
  // How many days to place them here this week (0 skips them). The generator sets
  // this from staffing mode + the 6-day combined cap.
  budget: number;
};

// Returns date → [personId, …] in placement order. A person never appears twice
// on the same date; total placements ≤ Σ budgets (fewer if free days run out).
export function planFlexPlacement(input: {
  flex: FlexPerson[];
  demandByDate: Record<string, number>; // relative busyness per date (e.g. items sold)
  baseHeadsByDate: Record<string, number>; // heads already rostered (FT skeleton) per date
}): Record<string, string[]> {
  const placed: Record<string, string[]> = {};
  const extra: Record<string, number> = {}; // flex heads added per date so far
  const remaining = new Map<string, number>();
  const takenBy = new Map<string, Set<string>>(); // personId → dates already given
  for (const p of input.flex) {
    if (p.budget > 0 && p.freeDays.length > 0) {
      remaining.set(p.id, Math.min(p.budget, p.freeDays.length));
      takenBy.set(p.id, new Set());
    }
  }
  const freeById = new Map(input.flex.map((p) => [p.id, p.freeDays]));

  // demand-per-head if we add one more head to date d — higher = more deserving.
  const priority = (d: string): number => {
    const demand = input.demandByDate[d] ?? 0;
    const heads = (input.baseHeadsByDate[d] ?? 0) + (extra[d] ?? 0);
    return demand / (heads + 1);
  };

  // Round-robin: each round every still-hungry person claims their best free day.
  // Interleaving people across rounds (rather than exhausting one at a time) is
  // what spreads heads over distinct days instead of clustering.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const p of input.flex) {
      const left = remaining.get(p.id) ?? 0;
      if (left <= 0) continue;
      const taken = takenBy.get(p.id)!;
      const candidates = (freeById.get(p.id) ?? []).filter((d) => !taken.has(d));
      if (candidates.length === 0) {
        remaining.set(p.id, 0);
        continue;
      }
      // Best day: max demand-per-head; ties broken by fewest flex heads already
      // there, then earliest date, for stable output.
      let best = candidates[0];
      for (const d of candidates) {
        const pd = priority(d), pb = priority(best);
        if (
          pd > pb ||
          (pd === pb && (extra[d] ?? 0) < (extra[best] ?? 0)) ||
          (pd === pb && (extra[d] ?? 0) === (extra[best] ?? 0) && d < best)
        ) {
          best = d;
        }
      }
      (placed[best] ??= []).push(p.id);
      extra[best] = (extra[best] ?? 0) + 1;
      taken.add(best);
      remaining.set(p.id, left - 1);
      progressed = true;
    }
  }
  return placed;
}
