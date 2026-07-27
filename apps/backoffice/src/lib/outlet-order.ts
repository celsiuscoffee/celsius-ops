// Canonical outlet display order (owner 2026-07-18: "sort (in all places)
// Putrajaya, Shah Alam, Tamarind, Nilai, IOI — it has been a problem"):
// business order, not the alphabet. Matches on code OR name so it works for
// every shape an outlet row takes ({id,name}, {id,code,name}, …). Unknown /
// future outlets sort after the known five, alphabetically.
const OUTLET_RANKS: Array<[RegExp, number]> = [
  [/putrajaya|conezion|cc001/i, 0],
  [/shah\s*alam|cc002/i, 1],
  [/tamarind|cc003/i, 2],
  [/nilai/i, 3],
  [/ioi/i, 4],
];

export function outletRank(o: { code?: string | null; name?: string | null }): number {
  const hay = `${o.code ?? ""} ${o.name ?? ""}`;
  for (const [re, rank] of OUTLET_RANKS) if (re.test(hay)) return rank;
  return OUTLET_RANKS.length;
}

// Stable canonical sort — returns a new array, original untouched.
export function sortOutlets<T extends { code?: string | null; name?: string | null }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => outletRank(a) - outletRank(b) || (a.name ?? "").localeCompare(b.name ?? ""),
  );
}
