// Pure matching helpers for the AP auto-matcher. No DB/IO imports so they are
// unit-testable and safe to import anywhere (ap-match.ts wires them to Prisma).

// Payee aliases (per owner): the name on the BANK transfer isn't always the
// supplier name on the INVOICE. Keys are matched by containment against the
// invoice's payee names (supplier / vendorName / bank-account name, lowered);
// values are PHRASES searched directly in the bank description — a phrase hit
// counts as full name confirmation, same weight as a payee-name token match.
export const PAYEE_ALIASES: Record<string, string[]> = {
  // "TMM Resources" on the bank side IS The Milk Ministry.
  "milk ministry": ["tmm"],
  "tmm": ["milk ministry"],
  // Ad-hoc purchases are staff-fronted and reimbursed to Ariff Izham.
  "ad-hoc purchase": ["ariff izham"],
  "adhoc purchase": ["ariff izham"],
};

// Alias phrases for an invoice's payee names — every alias whose key appears
// in any of the names.
export function aliasPhrasesFor(names: (string | null | undefined)[]): string[] {
  const joined = names.filter(Boolean).map((n) => (n as string).toLowerCase());
  const out = new Set<string>();
  for (const [key, phrases] of Object.entries(PAYEE_ALIASES)) {
    if (joined.some((n) => n.includes(key))) for (const p of phrases) out.add(p);
  }
  return [...out];
}

export function aliasInDesc(phrases: string[], descLower: string): boolean {
  return phrases.some((p) => descLower.includes(p));
}

// Invoice references in bank descriptions ("YSIV-0801", "INV 006545, 006577").
// Compare on trailing digit runs: the invoice's number reduced to its digits
// (leading zeros dropped) found as a digit run in the description.
export function digitRuns(s: string | null | undefined): string[] {
  return ((s ?? "").match(/\d{3,}/g) ?? []).map((d) => d.replace(/^0+/, "")).filter((d) => d.length >= 3);
}

export function invoiceRefInDesc(invoiceNumber: string | null | undefined, descRuns: string[]): boolean {
  const invDigits = (invoiceNumber ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (invDigits.length < 3) return false;
  return descRuns.some((r) => r === invDigits || r.endsWith(invDigits) || invDigits.endsWith(r));
}

// Subset of invoice amounts (in cents) summing to the target — suppliers are
// routinely paid for several invoices in ONE transfer, which single-invoice
// amount matching can never see. DFS over amounts sorted desc with pruning;
// bounded so a pathological supplier can't blow the loop up. Returns original
// indexes, or null. Subsets of size 1 are excluded (that's the single-match
// pass's job).
export function subsetSumIdx(cents: number[], target: number, maxSize = 8): number[] | null {
  const idx = cents.map((c, i) => [c, i] as const).sort((a, b) => b[0] - a[0]);
  const suffix: number[] = new Array(idx.length + 1).fill(0);
  for (let i = idx.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + idx[i][0];
  let steps = 0;
  const pick: number[] = [];
  const dfs = (i: number, remain: number): number[] | null => {
    if (Math.abs(remain) <= 2 && pick.length >= 2) return [...pick];
    if (i >= idx.length || remain < -2 || suffix[i] < remain - 2 || pick.length >= maxSize) return null;
    if (++steps > 20_000) return null;
    pick.push(idx[i][1]);
    const withIt = dfs(i + 1, remain - idx[i][0]);
    pick.pop();
    if (withIt) return withIt;
    return dfs(i + 1, remain);
  };
  return dfs(0, target);
}
