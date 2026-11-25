// Stock › Stock Count key numbers (restructure step 6, 17 Nov 2026), worked
// out from the counts the page already loads. Pure, so it is tested without
// the page.
//
// Units: expectedQty is base UOM (snapshotted from StockBalance), countedQty is
// what staff keyed in package units. Convert before comparing, as finalize does.

export type CountItem = {
  expectedQty: number | null;
  countedQty: number | null;
  packageConversion: number;
  varianceReason: string | null;
};
export type CountRow = { outlet: string; countDate: string; createdAt: string; items: CountItem[] };

const DAY = 86_400_000;

export function countedInBase(i: CountItem) {
  return (i.countedQty ?? 0) * (i.packageConversion > 0 ? i.packageConversion : 1);
}
const compared = (i: CountItem) => i.countedQty != null && i.expectedQty != null;
const off = (i: CountItem) => compared(i) && countedInBase(i) !== i.expectedQty;

/** Discrepancies still waiting for a reason code. */
export function unresolvedIn(sc: CountRow) {
  return sc.items.filter((i) => off(i) && !i.varianceReason).length;
}

export type CountSummary = {
  /** counts in the last 7 days, and how many outlets they cover */
  week: { counts: number; outlets: number };
  /** counts with at least one discrepancy that has no reason, and the items */
  waiting: { counts: number; items: number };
  /** last 30 days: compared items that matched the system exactly */
  accuracy: { matched: number; compared: number; share: number | null };
  /** last 30 days: items counted but never compared (no expected stock) */
  unchecked: { items: number; counted: number };
};

export function summariseCounts(rows: CountRow[], now: number): CountSummary {
  const t = (r: CountRow) => Date.parse(r.createdAt);
  const week = rows.filter((r) => now - t(r) < 7 * DAY);
  const month = rows.filter((r) => now - t(r) < 30 * DAY);

  const waitingRows = rows.filter((r) => unresolvedIn(r) > 0);
  let matched = 0, comparedN = 0, counted = 0;
  for (const r of month) for (const i of r.items) {
    if (i.countedQty == null) continue;
    counted++;
    if (!compared(i)) continue;
    comparedN++;
    if (!off(i)) matched++;
  }
  return {
    week: { counts: week.length, outlets: new Set(week.map((r) => r.outlet)).size },
    waiting: { counts: waitingRows.length, items: waitingRows.reduce((a, r) => a + unresolvedIn(r), 0) },
    accuracy: { matched, compared: comparedN, share: comparedN ? matched / comparedN : null },
    unchecked: { items: counted - comparedN, counted },
  };
}
