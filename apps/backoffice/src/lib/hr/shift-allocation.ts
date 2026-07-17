// Shift-count allocation — decides HOW MANY heads each shift template gets on a
// given day, purely from that day's hourly demand curve. WHO fills each slot
// (kitchen coverage, clopening guard, fairness rotation) is a separate, later
// concern in the generator.
//
// Why this exists: the old day-splitter derived the split from structural rules
// (fill closing to the floor, fill opening from non-clopeners, dump the whole
// remainder into closing unless opening already hit the floor). One evening-heavy
// day made most of the crew "clopeners", which barred them from opening the NEXT
// day — so opening starved at 2 heads all week while closing stacked 6–7. The
// crew mix also never looked at the demand curve, so a morning-peaked coffee
// outlet got an evening-heavy roster.
//
// This allocator is a marginal-gain greedy: place heads one at a time, each onto
// the template whose window has the largest remaining (demand − coverage) sum.
// Morning-heavy demand → more opening heads; a midday hump → middles absorb it;
// surplus heads (over-staffed FT) spread to wherever coverage is thinnest instead
// of piling onto one anchor. Pure and deterministic — unit-tested.

export type ShiftWindow = {
  key: string;
  startH: number; // inclusive hour, e.g. 7 for 07:30
  endH: number; // exclusive hour, e.g. 15 for a 15:30 end
};

// Returns key → head count. Σ counts = heads. With ≥2 heads and ≥2 windows, the
// first (opening) and last (closing) windows each get at least 1 — someone must
// unlock and lock the store regardless of demand shape.
export function allocateShiftCounts(input: {
  heads: number;
  windows: ShiftWindow[]; // ordered by start time: opening, middles…, closing
  demandByHour: Record<number, number>;
}): Map<string, number> {
  const { heads, windows, demandByHour } = input;
  const counts = new Map<string, number>(windows.map((w) => [w.key, 0]));
  if (heads <= 0 || windows.length === 0) return counts;

  const hoursOf = (w: ShiftWindow): number[] => {
    const out: number[] = [];
    for (let h = w.startH; h < w.endH; h++) out.push(h);
    return out;
  };
  const coverage = new Map<number, number>(); // hour → heads covering it
  const place = (w: ShiftWindow) => {
    counts.set(w.key, (counts.get(w.key) ?? 0) + 1);
    for (const h of hoursOf(w)) coverage.set(h, (coverage.get(h) ?? 0) + 1);
  };
  // Remaining unmet demand over a window — SHORTFALL only (over-covered hours
  // count 0, they must not cancel out a genuine gap elsewhere in the window).
  const gain = (w: ShiftWindow): number => {
    let g = 0;
    for (const h of hoursOf(w)) g += Math.max(0, (demandByHour[h] ?? 0) - (coverage.get(h) ?? 0));
    return g;
  };

  let remaining = heads;
  // The store must open and close: anchor 1 head on the first + last windows
  // (when there are heads and distinct windows to give them to).
  if (windows.length >= 2 && remaining >= 2) {
    place(windows[0]);
    place(windows[windows.length - 1]);
    remaining -= 2;
  }

  while (remaining > 0) {
    let best = windows[0];
    for (const w of windows) {
      const gw = gain(w), gb = gain(best);
      if (
        gw > gb ||
        (gw === gb && (counts.get(w.key) ?? 0) < (counts.get(best.key) ?? 0)) // tie → thinner template
      ) {
        best = w;
      }
    }
    // Demand fully covered everywhere → the remaining heads are SURPLUS (sunk FT
    // beyond what the day needs). Spread them evenly across templates instead of
    // letting the gain metric hoard them onto the anchors (whose edge hours are
    // always the least over-covered) — that's how 6-on-closing happened.
    if (gain(best) <= 0) {
      best = windows[0];
      for (const w of windows) {
        if ((counts.get(w.key) ?? 0) < (counts.get(best.key) ?? 0)) best = w;
      }
    }
    place(best);
    remaining--;
  }
  return counts;
}
