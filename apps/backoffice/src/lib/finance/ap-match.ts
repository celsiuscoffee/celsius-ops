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
import { getFinanceClient } from "./supabase";
import type { CashCategory } from "@celsius/db";

// Categories that can never be the settlement of a SUPPLIER invoice — wages
// (PT Week / part-timers), full-time salary, statutory (EPF/SOCSO/tax), director
// draws, financing, bank fees, petty-cash float. These collided on amount with
// real invoices and produced false matches; they're documented by a payment
// slip (payment-slips.ts) instead of an AP match. Inter-co is already excluded.
const NON_SUPPLIER_CATEGORIES: CashCategory[] = [
  "PARTIMER", "EMPLOYEE_SALARY", "STATUTORY_PAYMENT", "TAX",
  "DIRECTORS_ALLOWANCE", "ADTD", "LOAN", "CAPITAL", "DIVIDEND",
  "BANK_FEE", "PETTY_CASH",
];

export type MatchTier = "auto" | "review";
export type ApMatch = {
  invoiceId: string;
  invoiceNumber: string | null;
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
  linkOnly: boolean;    // invoice PAID via another route — link the line, don't re-mark the invoice
};
export type ApMultiMatch = {
  bankLineId: string;
  bankDesc: string;
  bankDate: string;
  amount: number;
  payee: string;
  invoiceIds: string[];
  invoiceNumbers: (string | null)[];
  refsConfirmed: number; // how many of the invoices' numbers appear in the description
  tier: MatchTier;
  reasons: string[];
};
export type ApMatchResult = {
  auto: ApMatch[];
  review: ApMatch[];
  multi: ApMultiMatch[];
  unmatchedInvoices: { invoiceId: string; invoiceNumber: string | null; payee: string; amount: number; issueDate: string }[];
  unmatchedOutflows: { bankLineId: string; desc: string; date: string; amount: number; category: string | null; expenseMonth: string | null }[];
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

import { digitRuns, invoiceRefInDesc, subsetSumIdx, aliasPhrasesFor, aliasInDesc, invoiceSig, descNamesForeignInvoice } from "./ap-match-lib";
export { digitRuns, invoiceRefInDesc, subsetSumIdx } from "./ap-match-lib";

export async function proposeApMatches(opts: { sinceDays?: number } = {}): Promise<ApMatchResult> {
  const sinceDays = opts.sinceDays ?? 120;
  const since = new Date(Date.now() - sinceDays * DAY);

  // Invoices in the window — INCLUDING already-PAID ones that no bank line
  // links to yet. Most invoices are marked paid through other routes (Telegram
  // POP confirms, the historical register migration) while their bank line sat
  // unmatched in OTHER_OUTFLOW — the P&L then counted the cost twice (once as
  // procurement COGS, again as the unmatched outflow). Matching those is
  // LINK-ONLY: the line gets tagged to the invoice, the invoice is untouched.
  // PAID invoices that already HAVE a linked line are excluded — a further
  // match against those would be a genuine double-payment, not a settlement.
  const [invoicesRaw, linkedRows] = await Promise.all([
    prisma.invoice.findMany({
      where: { issueDate: { gte: since } },
      select: {
        id: true, invoiceNumber: true, amount: true, amountPaid: true, status: true,
        issueDate: true, outletId: true,
        vendorName: true, vendorBankAccountName: true,
        supplier: { select: { name: true } },
      },
    }),
    prisma.bankStatementLine.findMany({
      where: { apInvoiceId: { not: null } },
      select: { apInvoiceId: true },
    }),
  ]);
  const linkedInvoiceIds = new Set(linkedRows.map((r) => r.apInvoiceId as string));
  // Open invoices claim lines first; paid-but-unlinked settle for what's left.
  const invoices = [
    ...invoicesRaw.filter((i) => i.status !== "PAID"),
    ...invoicesRaw.filter((i) => i.status === "PAID" && !linkedInvoiceIds.has(i.id)),
  ];

  // Candidate bank outflows: DR, not inter-co, in the window, and NOT a category
  // that can never have a supplier invoice — wages ("PT Week"), statutory, tax,
  // director draws, financing, bank fees. Those collide on amount with real
  // invoices and were the main source of false matches; they're documented by a
  // payment slip instead (see payment-slips.ts), not an AP match. Null/unknown
  // categories stay in the pool — those are exactly the OTHER_OUTFLOW pile to match.
  const lines = await prisma.bankStatementLine.findMany({
    where: {
      direction: "DR", isInterCo: false, txnDate: { gte: since }, apInvoiceId: null,
      OR: [{ category: null }, { category: { notIn: NON_SUPPLIER_CATEGORIES } }],
    },
    select: { id: true, description: true, amount: true, txnDate: true, category: true, expenseMonth: true },
  });

  // Index bank lines by rounded amount for fast candidate lookup.
  const byAmount = new Map<number, typeof lines>();
  for (const l of lines) {
    const k = Math.round(Number(l.amount) * 100);
    (byAmount.get(k) ?? byAmount.set(k, []).get(k)!).push(l);
  }

  // Distinctive (>= 5 digit) invoice-number signatures across every invoice in
  // play. Used to detect a bank line whose narration NAMES a specific, different
  // invoice — those lines belong to the invoice they name, so amount+payee must
  // not auto-settle a same-amount sibling against them (the fixed-amount
  // mis-match: TMM / Milk n Moka bill identical amounts every order).
  const knownSigs = new Set<string>(
    invoices.map((i) => invoiceSig(i.invoiceNumber)).filter((s) => s.length >= 5),
  );

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
    const aliases = aliasPhrasesFor([inv.supplier?.name, inv.vendorName, inv.vendorBankAccountName]);
    const issue = inv.issueDate;
    const linkOnly = inv.status === "PAID"; // paid via another route, line unlinked
    const alreadyPaid = !linkOnly && Number(inv.amountPaid ?? 0) >= amt - 0.01;

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
      // Skip a line that quotes a DIFFERENT known invoice number: it belongs to
      // the invoice it names, not this same-amount sibling. Leaving it unmatched
      // (it surfaces for human review) beats silently mis-assigning the payment.
      // The invoice the line DOES name will match it in its own turn (a name hit
      // scores highest), regardless of processing order.
      if (descNamesForeignInvoice(descLower, knownSigs, inv.invoiceNumber)) continue;
      const amtDiff = Math.abs(Number(l.amount) - amt);
      const reasons: string[] = [];
      let score = 0;
      if (amtDiff <= 0.01) { score += 0.55; reasons.push("amount exact"); }
      else { score += 0.35; reasons.push(`amount ~ (RM${amtDiff.toFixed(2)} off)`); }
      const named = nameInDesc(nm, descLower) || aliasInDesc(aliases, descLower);
      if (named) { score += 0.4; reasons.push("payee name in description"); }
      // The invoice's own number quoted in the transfer is the strongest signal
      // a bank line carries — count it as identity confirmation like a name hit.
      if (invoiceRefInDesc(inv.invoiceNumber, digitRuns(descLower))) {
        score += named ? 0.05 : 0.4;
        reasons.push("invoice no in description");
      }
      if (dDays <= 14) { score += 0.1; reasons.push("paid ≤14d of issue"); }
      else if (dDays <= 45) { score += 0.05; }

      if (!best || score > best.score) {
        best = {
          invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, payee, amount: amt, issueDate: ymd(issue),
          outletId: inv.outletId, bankLineId: l.id, bankDesc: (l.description ?? "").replace(/\s+/g, " ").slice(0, 60),
          bankDate: ymd(l.txnDate), bankCategory: l.category as string | null,
          score: round2(score), tier: "review", reasons, alreadyPaid, linkOnly,
        };
      }
    }

    if (best && best.score >= 0.55) {
      // AUTO requires amount-exact AND identity confirmation — payee name or
      // the invoice number quoted in the transfer (score ≥ 0.85 needs one).
      const confirmed = best.reasons.includes("payee name in description") || best.reasons.includes("invoice no in description");
      best.tier = best.score >= 0.85 && best.reasons.includes("amount exact") && confirmed ? "auto" : "review";
      if (best.linkOnly) best.reasons.push("invoice already paid via another route — link-only");
      usedBankLineIds.add(best.bankLineId);
      matchedInvoiceIds.add(inv.id);
      if (best.alreadyPaid) doublePayments.push(best);
      else (best.tier === "auto" ? auto : review).push(best);
    } else if (!linkOnly) {
      // Only OPEN invoices are worth reporting as unmatched — a paid-unlinked
      // invoice with no line match is just history without a feed-era payment.
      unmatchedInvoices.push({ invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, payee, amount: amt, issueDate: ymd(issue) });
    }
  }

  // ── Multi-invoice pass ─────────────────────────────────────────────────────
  // Suppliers are routinely paid several invoices in ONE transfer (the bank
  // line even lists the invoice numbers: "INV 006545, 006577, 006556…"), which
  // single-invoice amount matching can never see. For each still-unmatched
  // outflow, try each supplier whose name or invoice refs appear in the
  // description: find the subset of their open invoices summing to the amount.
  const multi: ApMultiMatch[] = [];
  {
    type Inv = (typeof invoices)[number];
    const bySupplier = new Map<string, { payee: string; toks: string[]; aliases: string[]; invs: Inv[] }>();
    for (const inv of invoices) {
      if (matchedInvoiceIds.has(inv.id)) continue;
      // Paid-but-unlinked invoices stay in the bundle pool (link-only members);
      // open invoices with a settled amountPaid are the double-pay guard.
      if (inv.status !== "PAID" && Number(inv.amountPaid ?? 0) >= Number(inv.amount) - 0.01) continue;
      const payee = inv.supplier?.name ?? inv.vendorName ?? inv.vendorBankAccountName ?? "(unknown payee)";
      const key = payee.toLowerCase();
      const g = bySupplier.get(key) ?? {
        payee,
        toks: [...new Set([...tokens(inv.supplier?.name), ...tokens(inv.vendorName), ...tokens(inv.vendorBankAccountName)])],
        aliases: aliasPhrasesFor([inv.supplier?.name, inv.vendorName, inv.vendorBankAccountName]),
        invs: [],
      };
      g.invs.push(inv);
      bySupplier.set(key, g);
    }

    for (const l of lines) {
      if (usedBankLineIds.has(l.id)) continue;
      const descLower = (l.description ?? "").toLowerCase();
      const runs = digitRuns(descLower);
      const target = Math.round(Number(l.amount) * 100);

      let found: ApMultiMatch | null = null;
      for (const g of bySupplier.values()) {
        if (g.invs.length < 2) continue;
        const refHits = g.invs.filter((i) => invoiceRefInDesc(i.invoiceNumber, runs)).length;
        const named = nameInDesc(g.toks, descLower) || aliasInDesc(g.aliases, descLower);
        if (!named && refHits === 0) continue;

        const pickIdx = subsetSumIdx(g.invs.map((i) => Math.round(Number(i.amount) * 100)), target);
        if (!pickIdx) continue;
        const picked = pickIdx.map((i) => g.invs[i]);
        const refsConfirmed = picked.filter((i) => invoiceRefInDesc(i.invoiceNumber, runs)).length;
        // AUTO only when the transfer itself confirms the bundle: every picked
        // invoice's number quoted, or all-but-one quoted alongside a name hit.
        const tier: MatchTier =
          refsConfirmed === picked.length || (named && refsConfirmed >= picked.length - 1 && refsConfirmed >= 1)
            ? "auto" : "review";
        const reasons = [
          `sum of ${picked.length} invoices = amount`,
          ...(named ? ["payee name in description"] : []),
          ...(refsConfirmed ? [`${refsConfirmed}/${picked.length} invoice nos in description`] : []),
        ];
        found = {
          bankLineId: l.id, bankDesc: (l.description ?? "").replace(/\s+/g, " ").slice(0, 60),
          bankDate: ymd(l.txnDate), amount: round2(Number(l.amount)), payee: g.payee,
          invoiceIds: picked.map((i) => i.id), invoiceNumbers: picked.map((i) => i.invoiceNumber),
          refsConfirmed, tier, reasons,
        };
        if (tier === "auto") break; // best possible for this line
      }
      if (found) {
        usedBankLineIds.add(found.bankLineId);
        for (const id of found.invoiceIds) matchedInvoiceIds.add(id);
        multi.push(found);
      }
    }
  }

  // Unmatched outflows = catch-all/uncategorized DR lines with no invoice match
  // (the real "needs review" cash-out the user asked to see).
  const unmatchedOutflows = lines
    .filter((l) => !usedBankLineIds.has(l.id) && (l.category === null || l.category === "OTHER_OUTFLOW"))
    .map((l) => ({ bankLineId: l.id, desc: (l.description ?? "").replace(/\s+/g, " ").slice(0, 60), date: ymd(l.txnDate), amount: round2(Number(l.amount)), category: l.category as string | null, expenseMonth: l.expenseMonth ? ymd(l.expenseMonth).slice(0, 7) : null }))
    .sort((a, b) => b.amount - a.amount);

  // Human verdicts are final: a pair the owner rejected (or unmatched) never
  // re-surfaces in review and never auto-applies — without this, every propose
  // run would resurrect the same wrong suggestion.
  const rejected = await fetchMatchRejections();
  const keep = (m: ApMatch) => !rejected.has(`${m.bankLineId}|${m.invoiceId}`);
  const keepMulti = (m: ApMultiMatch) => m.invoiceIds.every((inv) => !rejected.has(`${m.bankLineId}|${inv}`));

  return {
    auto: auto.filter(keep),
    review: review.filter(keep),
    multi: multi.filter(keepMulti),
    unmatchedInvoices: unmatchedInvoices.filter((i) => !matchedInvoiceIds.has(i.invoiceId)),
    unmatchedOutflows, doublePayments,
  };
}

// Rejected (bank line, invoice) pairs as "lineId|invoiceId" keys. Failure to
// read must not take the matcher down — degrade to no filtering.
async function fetchMatchRejections(): Promise<Set<string>> {
  try {
    const client = getFinanceClient();
    const { data, error } = await client.from("fin_ap_match_rejections").select("bank_line_id, invoice_id");
    if (error) return new Set();
    return new Set((data ?? []).map((r) => `${r.bank_line_id}|${r.invoice_id}`));
  } catch {
    return new Set();
  }
}

// ── VERIFIER + APPLY ────────────────────────────────────────────────────────
// The verifier is the loop's independent second pair of eyes: it re-checks
// each AUTO proposal against hard rules before any write is allowed. Only
// matches that pass BOTH the matcher's score AND the verifier auto-apply; the
// rest fall to the human review queue. This is what lets the loop clear
// invoices with no bookkeeper.
export function verifyMatch(m: ApMatch): { ok: boolean; reason?: string } {
  if (m.tier !== "auto") return { ok: false, reason: "not auto-tier" };
  if (!m.reasons.includes("amount exact")) return { ok: false, reason: "amount not exact" };
  if (!m.reasons.includes("payee name in description") && !m.reasons.includes("invoice no in description")) {
    return { ok: false, reason: "identity not confirmed in bank line (no payee name or invoice no)" };
  }
  if (m.alreadyPaid) return { ok: false, reason: "invoice already settled — possible double-pay" };
  return { ok: true };
}

export type ApplyResult = {
  committed: boolean;
  applied: number;
  skipped: { payee: string; amount: number; reason: string }[];
};

// Apply verified AUTO matches: link the bank line to its invoice, mark the
// invoice PAID, and tag classifiedBy='ap-match'. The linked line then drops
// out of P&L opex (it settles a liability, not a new expense). Idempotent and
// transactional. Dry-run (commit=false) reports what WOULD apply.
// The single write: link the bank line to its invoice + mark the invoice paid.
// Idempotent + transactional. Shared by the rules-tier auto-apply and the
// LLM-verified review-tier apply.
export async function writeApMatch(m: ApMatch): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const line = await tx.bankStatementLine.findUnique({ where: { id: m.bankLineId }, select: { apInvoiceId: true, category: true } });
    if (line?.apInvoiceId) return; // already matched — idempotent
    const inv = await tx.invoice.findUnique({ where: { id: m.invoiceId }, select: { status: true, amount: true } });
    if (!inv) return;
    // link-only: the invoice was paid via another route (POP / migration) —
    // expect it PAID and leave it alone. Normal match: expect it open.
    if (m.linkOnly ? inv.status !== "PAID" : inv.status === "PAID") return;
    await tx.bankStatementLine.update({
      where: { id: m.bankLineId },
      data: {
        apInvoiceId: m.invoiceId, apMatchedAt: new Date(), classifiedBy: "ap-match",
        // A matched line settles a procurement invoice — pull it out of the
        // catch-all so the GL posts it as COGS, not Suspense.
        ...(line?.category === null || line?.category === "OTHER_OUTFLOW" ? { category: "RAW_MATERIALS" as CashCategory } : {}),
      },
    });
    if (!m.linkOnly) {
      await tx.invoice.update({
        where: { id: m.invoiceId },
        data: { amountPaid: inv.amount, status: "PAID", paidAt: new Date(m.bankDate + "T00:00:00Z"), paidVia: "bank-ap-match" },
      });
    }
  });
}

// One transfer settling several invoices: link the line to the first invoice
// (the FK is single) and mark every invoice in the bundle paid, stamped with
// the bank line id so the trail survives the single-column link.
export async function writeMultiMatch(m: ApMultiMatch): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const line = await tx.bankStatementLine.findUnique({ where: { id: m.bankLineId }, select: { apInvoiceId: true, category: true } });
    if (line?.apInvoiceId) return; // already matched — idempotent
    const invs = await tx.invoice.findMany({ where: { id: { in: m.invoiceIds } }, select: { id: true, status: true, amount: true } });
    if (invs.length !== m.invoiceIds.length) return;
    await tx.bankStatementLine.update({
      where: { id: m.bankLineId },
      data: {
        apInvoiceId: m.invoiceIds[0], apMatchedAt: new Date(), classifiedBy: "ap-match",
        ...(line?.category === null || line?.category === "OTHER_OUTFLOW" ? { category: "RAW_MATERIALS" as CashCategory } : {}),
      },
    });
    // Bundle members already PAID via another route are link-only: the line
    // now references the bundle, the invoice keeps its original payment trail.
    for (const inv of invs) {
      if (inv.status === "PAID") continue;
      await tx.invoice.update({
        where: { id: inv.id },
        data: { amountPaid: inv.amount, status: "PAID", paidAt: new Date(m.bankDate + "T00:00:00Z"), paidVia: `bank-ap-match-multi:${m.bankLineId}` },
      });
    }
  });
}

// markOpenPaid gates whether this run may MARK AN OPEN INVOICE PAID from the
// bank statement. Default FALSE: the Telegram proof-of-payment flow is the
// primary payer, so the routine (6-hourly) run only RECONCILES — it applies
// link-only matches (tag a bank line to an invoice already paid via POP/manual,
// dropping it out of P&L opex) and holds any open-invoice match for the EOM
// bank reconciliation. Set TRUE only for the month-end recon runner, which is
// allowed to settle whatever the POP flow didn't catch.
export async function applyApMatches(
  opts: { commit?: boolean; sinceDays?: number; markOpenPaid?: boolean } = {},
): Promise<ApplyResult> {
  const commit = opts.commit ?? false;
  const markOpenPaid = opts.markOpenPaid ?? false;
  const { auto, multi } = await proposeApMatches({ sinceDays: opts.sinceDays });
  const skipped: ApplyResult["skipped"] = [];
  let applied = 0;
  for (const m of auto) {
    // Reconcile-only by default: an open-invoice match waits for the Telegram
    // POP (primary) or the EOM bank reconciliation, never a silent no-POP pay.
    if (!m.linkOnly && !markOpenPaid) {
      skipped.push({ payee: m.payee, amount: m.amount, reason: "open invoice — held for POP / EOM bank reconciliation" });
      continue;
    }
    const v = verifyMatch(m);
    if (!v.ok) { skipped.push({ payee: m.payee, amount: m.amount, reason: v.reason! }); continue; }
    if (commit) await writeApMatch(m);
    applied++;
  }
  for (const m of multi) {
    if (m.tier !== "auto") { skipped.push({ payee: m.payee, amount: m.amount, reason: "multi-invoice bundle not ref-confirmed" }); continue; }
    // A bundle settles its OPEN members, so it's an open-invoice payment too —
    // hold it for the EOM reconciliation unless explicitly enabled.
    if (!markOpenPaid) {
      skipped.push({ payee: m.payee, amount: m.amount, reason: "multi-invoice bundle — held for POP / EOM bank reconciliation" });
      continue;
    }
    if (commit) await writeMultiMatch(m);
    applied++;
  }
  return { committed: commit, applied, skipped };
}
