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

// The distinctive numeric signature of an invoice number (digits, leading zeros
// dropped). Only signatures of >= 5 digits are treated as identifying — shorter
// runs collide with dates/amounts/account tails and would over-veto.
export function invoiceSig(invoiceNumber: string | null | undefined): string {
  return (invoiceNumber ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

// True when a bank description quotes a DISTINCTIVE invoice number that is NOT
// this invoice's — i.e. the transfer is spoken for by a different, known
// invoice, so amount + payee-name alone must NOT auto-settle THIS invoice
// against that line. This is the guard against the fixed-amount mis-match:
// suppliers like TMM / Milk n Moka bill the same amount every order, so
// amount+payee matched the wrong same-amount invoice while the bank narration
// clearly named another. `knownSigs` is the set of invoiceSig() over every
// invoice in play (already filtered to >= 5 digits).
export function descNamesForeignInvoice(
  descLower: string | null | undefined,
  knownSigs: Set<string>,
  thisInvoiceNumber: string | null | undefined,
): boolean {
  const runs = digitRuns(descLower);
  if (runs.length === 0 || knownSigs.size === 0) return false;
  // If the line names THIS invoice, it's confirmation, not a foreign ref.
  if (invoiceRefInDesc(thisInvoiceNumber, runs)) return false;
  const mine = invoiceSig(thisInvoiceNumber);
  for (const sig of knownSigs) {
    if (sig.length < 5 || sig === mine) continue;
    if (runs.some((r) => r === sig || r.endsWith(sig) || sig.endsWith(r))) return true;
  }
  return false;
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

// A "number" that is really a DATE must never confirm an invoice. Ad-hoc staff
// claims are numbered by week ("LALA CCT WEEK 24082026", "CLEANING CCT WEEK
// 24082026") and ordinary bank narration quotes dates too ("DR/CARD SALES M/N
// 2612988 DATED 24082026") — replaying 120 days of production, that collision
// pointed eight card-terminal fee lines (RM0.67-3.23) at a RM61.30 cleaning
// claim. Any 6- or 8-digit run that parses as a plausible calendar date in
// either DD-MM-Y or Y-MM-DD order disqualifies the whole number as a reference.
// Rejecting a genuine number that merely looks like a date only costs a signal;
// accepting a date costs a wrong match.
export function isDateLikeNumber(raw: string | null | undefined): boolean {
  const ok = (y: number, m: number, d: number) => y >= 2020 && y <= 2035 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  for (const run of (raw ?? "").match(/\d{6,8}/g) ?? []) {
    if (run.length === 8) {
      if (ok(+run.slice(4), +run.slice(2, 4), +run.slice(0, 2))) return true; // DDMMYYYY
      if (ok(+run.slice(0, 4), +run.slice(4, 6), +run.slice(6))) return true; // YYYYMMDD
    } else if (run.length === 6) {
      if (ok(2000 + +run.slice(4), +run.slice(2, 4), +run.slice(0, 2))) return true; // DDMMYY
      if (ok(2000 + +run.slice(0, 2), +run.slice(2, 4), +run.slice(4))) return true; // YYMMDD
    }
  }
  return false;
}

// ── Split payments (one invoice, several bank lines) ─────────────────────────
// Deposit-then-balance suppliers (Collective Project: "IV-02159 Depo" RM281.50
// then "IV-02159 Bal" RM2,533.50) and instalment payers settle ONE invoice with
// several transfers, so no single line ever equals the invoice amount and the
// single-line pass can't see it. Given the candidate legs already filtered to
// this invoice's identity (invoice no quoted → ref, payee name → named), pick
// the legs that settle the remaining balance, or — failing that — the
// ref-confirmed legs that form a PARTIAL payment (deposit paid, balance still
// outstanding). Partial picks never use name-only legs: any small transfer to
// the supplier would qualify, which is exactly the loose match we refuse.
export type SplitLegCandidate = { cents: number; ref: boolean; named: boolean };
export type SplitPick = { idx: number[]; settles: boolean };

export function pickSplitLegs(legs: SplitLegCandidate[], targetCents: number, maxLegs = 4): SplitPick | null {
  if (targetCents <= 2 || legs.length === 0) return null;
  const tryPool = (pool: number[]): number[] | null => {
    if (pool.length === 0) return null;
    // a single leg equal to the remaining balance (the "Bal" leg after a
    // manually recorded deposit) is the commonest case
    const single = pool.find((i) => Math.abs(legs[i].cents - targetCents) <= 2);
    if (single !== undefined) return [single];
    const sub = subsetSumIdx(pool.map((i) => legs[i].cents), targetCents, maxLegs);
    return sub ? sub.map((j) => pool[j]) : null;
  };
  const refIdx = legs.map((l, i) => (l.ref ? i : -1)).filter((i) => i >= 0);
  const allIdx = legs.map((l, i) => (l.ref || l.named ? i : -1)).filter((i) => i >= 0);
  const full = tryPool(refIdx) ?? tryPool(allIdx);
  if (full) return { idx: full, settles: true };
  // Partial: every ref-confirmed leg, only when together they stay UNDER the
  // balance (over would mean a stray leg or a different invoice).
  if (refIdx.length === 0 || refIdx.length > maxLegs) return null;
  const sum = refIdx.reduce((s, i) => s + legs[i].cents, 0);
  if (sum <= 0 || sum >= targetCents - 2) return null;
  return { idx: refIdx, settles: false };
}
