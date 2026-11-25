// Stock › Wastage key numbers (restructure step 6, 17 Nov 2026), worked out
// from the wastage list the page already loads. Days and months are Malaysia
// time. Pure, so it is tested without the page.

export type WasteRow = { product: string; costAmount: number | null; reason: string | null; createdAt: string };

export type WasteSummary = {
  last7: number;
  prev7: number;
  /** change vs the 7 days before, as a fraction; null when there was nothing before */
  change7: number | null;
  thisMonth: number;
  lastMonth: number;
  topReason: { reason: string; amount: number; share: number } | null;
  topItem: { product: string; amount: number } | null;
};

const MYT = 8 * 3600_000;
const DAY = 86_400_000;
const monthKey = (ms: number) => new Date(ms + MYT).toISOString().slice(0, 7);

export function summariseWaste(rows: WasteRow[], now: number): WasteSummary {
  const cost = (r: WasteRow) => r.costAmount ?? 0;
  const t = (r: WasteRow) => Date.parse(r.createdAt);
  const in7 = rows.filter((r) => now - t(r) < 7 * DAY && t(r) <= now);
  const prev = rows.filter((r) => now - t(r) >= 7 * DAY && now - t(r) < 14 * DAY);
  const last7 = in7.reduce((a, r) => a + cost(r), 0);
  const prev7 = prev.reduce((a, r) => a + cost(r), 0);

  const thisKey = monthKey(now);
  const d = new Date(now + MYT);
  const lastKey = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  let thisMonth = 0, lastMonth = 0;
  for (const r of rows) {
    const k = monthKey(t(r));
    if (k === thisKey) thisMonth += cost(r);
    else if (k === lastKey) lastMonth += cost(r);
  }

  const top = (key: (r: WasteRow) => string) => {
    const m = new Map<string, number>();
    for (const r of in7) m.set(key(r), (m.get(key(r)) ?? 0) + cost(r));
    let best: [string, number] | null = null;
    for (const e of m) if (e[1] > 0 && (!best || e[1] > best[1])) best = e;
    return best;
  };
  const reason = top((r) => r.reason?.trim() || "No reason given");
  const item = top((r) => r.product);

  return {
    last7, prev7,
    change7: prev7 > 0 ? (last7 - prev7) / prev7 : null,
    thisMonth, lastMonth,
    topReason: reason ? { reason: reason[0], amount: reason[1], share: last7 > 0 ? reason[1] / last7 : 0 } : null,
    topItem: item ? { product: item[0], amount: item[1] } : null,
  };
}
