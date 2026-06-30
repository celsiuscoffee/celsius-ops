// AP auto-match — the cash-OUT reconciliation step of the finance loop.
//
// Matches bank outflow lines (BankStatementLine, direction DR) to open
// procurement invoices, confidence-scored on amount + payee-name + date, so
// the loop can: clear the invoice (mark paid), re-tag the bank line to its
// real category (pulling it out of the OTHER_OUTFLOW catch-all + killing the
// COGS double-count), and flag double-payments — all WITHOUT a human.
//
// This module is READ-ONLY: it proposes matches with a confidence tier. The
// apply step (writes invoice.paidAt + bank line link/category) and the
// verifier sit on top, and only HIGH-confidence proposals auto-apply; MID go
// to the review queue; the rest surface as unreconciled.
//
// Scoring (0..1):
//   amount exact (≤RM0.01)            +0.55   | within 0.5%   +0.35
//   payee name/bank-acct in bank desc +0.40
//   paid within 14d of issue          +0.10   | within 45d    +0.05
//   tiers: AUTO ≥ 0.85 (needs amount-exact AND name) · REVIEW ≥ 0.55 · else none

import { prisma } from "@/lib/prisma";

export type MatchTier = "auto" | "review";
export type ApMatch = {
  invoiceId: string;
  invoiceNo: string | null;
  payee: string;
  amount: number;
  issueDate: string;
  outletId: string | null;
  bankLineId: string;
  bankDesc: string;
  bankDate: string;
  bankCategory: string | null;
  score: number;
  tier: MatchTier;
  reasons: string[];
  alreadyPaid: boolean; // invoice was already settled → potential double-payment
};
export type ApMatchResult = {
  auto: ApMatch[];
  review: ApMatch[];
  unmatchedInvoices: { invoiceId: string; invoiceNo: string | null; payee: string; amount: number; issueDate: string }[];
  unmatchedOutflows: { bankLineId: string; desc: string; date: string; amount: number; category: string | null }[];
  doublePayments: ApMatch[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86400_000;

// Normalise a name to comparable tokens (drop SDN/BHD/ENTERPRISE noise + punctuation).
const STOP = new Set(["sdn", "bhd", "enterprise", "trading", "resources", "the", "and", "sb", "co", "ent"]);
function tokens(s: string | null | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}
function nameInDesc(nameTokens: string[], descLower: string): boolean {
  if (nameTokens.length === 0) return false;
  const hits = nameTokens.filter((t) => descLower.includes(t)).length;
  // A single distinctive token (e.g. "xora", "365eat") or ≥2 tokens is a match.
  return hits >= 2 || (hits === 1 && nameTokens.some((t) => t.length >= 5 && descLower.includes(t)));
}

export async function proposeApMatches(opts: { sinceDays?: number } = {}): Promise<ApMatchResult> {
  const sinceDays = opts.sinceDays ?? 120;
  const since = new Date(Date.now() - sinceDays * DAY);

  // Open (not fully paid) invoices in the window.
  const invoices = await prisma.invoice.findMany({
    where: {
      issueDate: { gte: since },
      status: { not: "PAID" }, // open invoices; alreadyPaid flag still catches partial double-pays
    },
    select: {
      id: true, invoiceNumber: true, amount: true, amountPaid: true, status: true,
      issueDate: true, outletId: true,
      vendorName: true, vendorBankAccountName: true,
      supplier: { select: { name: true } },
    },
  });

  // Candidate bank outflows: DR, not inter-co, in the window. We only care about
  // lines that aren't already a confidently-typed non-supplier expense (payroll,
  // rent, etc. are pulse categories) — but to be safe we consider all DR and let
  // the score gate it.
  const lines = await prisma.bankStatementLine.findMany({
    where: { direction: "DR", isInterCo: false, txnDate: { gte: since } },
    select: { id: true, description: true, amount: true, txnDate: true, category: true },
  });

  // Index bank lines by rounded amount for fast candidate lookup.
  const byAmount = new Map<number, typeof lines>();
  for (const l of lines) {
    const k = Math.round(Number(l.amount) * 100);
    (byAmount.get(k) ?? byAmount.set(k, []).get(k)!).push(l);
  }

  const auto: ApMatch[] = [];
  const review: ApMatch[] = [];
  const doublePayments: ApMatch[] = [];
  const matchedInvoiceIds = new Set<string>();
  const usedBankLineIds = new Set<string>();
  const unmatchedInvoices: ApMatchResult["unmatchedInvoices"] = [];

  for (const inv of invoices) {
    const amt = round2(Number(inv.amount));
    const payee = inv.supplier?.name ?? inv.vendorName ?? inv.vendorBankAccountName ?? "(unknown payee)";
    const nm = [...new Set([...tokens(inv.supplier?.name), ...tokens(inv.vendorName), ...tokens(inv.vendorBankAccountName)])];
    const issue = inv.issueDate;
    const alreadyPaid = Number(inv.amountPaid ?? 0) >= amt - 0.01;

    // Candidate amounts: exact + ±0.5%.
    const tol = Math.max(1, Math.round(amt * 0.005 * 100));
    const exactK = Math.round(amt * 100);
    const cands: typeof lines = [];
    for (let k = exactK - tol; k <= exactK + tol; k++) {
      const arr = byAmount.get(k);
      if (arr) cands.push(...arr);
    }

    let best: ApMatch | null = null;
    for (const l of cands) {
      if (usedBankLineIds.has(l.id)) continue;
      const dDays = Math.abs(l.txnDate.getTime() - issue.getTime()) / DAY;
      if (l.txnDate.getTime() < issue.getTime() - 7 * DAY || dDays > 60) continue;

      const descLower = (l.description ?? "").toLowerCase();
      const amtDiff = Math.abs(Number(l.amount) - amt);
      const reasons: string[] = [];
      let score = 0;
      if (amtDiff <= 0.01) { score += 0.55; reasons.push("amount exact"); }
      else { score += 0.35; reasons.push(`amount ~ (RM${amtDiff.toFixed(2)} off)`); }
      const named = nameInDesc(nm, descLower);
      if (named) { score += 0.4; reasons.push("payee name in description"); }
      if (dDays <= 14) { score += 0.1; reasons.push("paid ≤14d of issue"); }
      else if (dDays <= 45) { score += 0.05; }

      if (!best || score > best.score) {
        best = {
          invoiceId: inv.id, invoiceNo: inv.invoiceNumber, payee, amount: amt, issueDate: ymd(issue),
          outletId: inv.outletId, bankLineId: l.id, bankDesc: (l.description ?? "").replace(/\s+/g, " ").slice(0, 60),
          bankDate: ymd(l.txnDate), bankCategory: l.category as string | null,
          score: round2(score), tier: "review", reasons, alreadyPaid,
        };
      }
    }

    if (best && best.score >= 0.55) {
      // AUTO requires amount-exact AND a name hit (score ≥ 0.85 only achievable that way).
      best.tier = best.score >= 0.85 && best.reasons.includes("amount exact") && best.reasons.includes("payee name in description") ? "auto" : "review";
      usedBankLineIds.add(best.bankLineId);
      matchedInvoiceIds.add(inv.id);
      if (best.alreadyPaid) doublePayments.push(best);
      else (best.tier === "auto" ? auto : review).push(best);
    } else {
      unmatchedInvoices.push({ invoiceId: inv.id, invoiceNo: inv.invoiceNumber, payee, amount: amt, issueDate: ymd(issue) });
    }
  }

  // Unmatched outflows = catch-all/uncategorized DR lines with no invoice match
  // (the real "needs review" cash-out the user asked to see).
  const unmatchedOutflows = lines
    .filter((l) => !usedBankLineIds.has(l.id) && (l.category === null || l.category === "OTHER_OUTFLOW"))
    .map((l) => ({ bankLineId: l.id, desc: (l.description ?? "").replace(/\s+/g, " ").slice(0, 60), date: ymd(l.txnDate), amount: round2(Number(l.amount)), category: l.category as string | null }))
    .sort((a, b) => b.amount - a.amount);

  return { auto, review, unmatchedInvoices, unmatchedOutflows, doublePayments };
}
