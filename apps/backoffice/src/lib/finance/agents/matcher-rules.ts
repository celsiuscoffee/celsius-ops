// Matcher — rules-first reconciliation core (pure, no IO).
//
// Decides what a single bank line reconciles to. ~80–90% of reconciliation is
// deterministic (exact reference, exact amount within a date window, rounding),
// so that lives here as auditable rules; the fuzzy residual (fee-net card
// settlements, batched deposits, partial payments) is deferred to an LLM pass.
//
// Direction is read from the SIGN of the bank amount: inflow (+) settles AR
// (invoices), outflow (−) settles AP (bills). Confidence ≥ threshold (default
// 0.90, the spec's Matcher bar) auto-matches; anything else returns an
// exception carrying the best proposal for the inbox / LLM.
//
// IO (loading candidates, writing fin_matches, updating payment_status,
// raising exceptions) lives in matcher.ts. This module is unit-tested in
// isolation against fixtures — no bank-feed source required.

export type BankLine = {
  id: string;
  amount: number; // signed RM: + inflow, − outflow
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  bankAccountCode: string;
};

export type Candidate = {
  type: "invoice" | "bill" | "transaction";
  id: string;
  direction: "ar" | "ap"; // ar settles via inflow, ap via outflow
  outstanding: number; // absolute RM still to reconcile (total − paid)
  date: string; // YYYY-MM-DD (invoice_date / bill_date / txn_date)
  number: string | null; // invoice_number / bill_number / null
  outletId: string | null;
};

export type MatchOptions = {
  dateWindowDays?: number; // default 3
  amountTolerance?: number; // default 0.05 — rounding only, NOT fee-net
  autoThreshold?: number; // default 0.90
};

export type MatchRule =
  | "reference_exact"
  | "amount_date_exact"
  | "amount_within_window"
  | "amount_rounding";

export type MatchDecision =
  | {
      kind: "matched";
      candidateId: string;
      candidateType: Candidate["type"];
      amountMatched: number;
      confidence: number;
      rule: MatchRule;
    }
  | {
      kind: "exception";
      reason: string;
      proposed: { candidateId: string; candidateType: Candidate["type"]; confidence: number } | null;
    };

const DEFAULTS = { dateWindowDays: 3, amountTolerance: 0.05, autoThreshold: 0.9 };

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T12:00:00+08:00`).getTime();
  const db = new Date(`${b}T12:00:00+08:00`).getTime();
  return Math.round(Math.abs(db - da) / 86_400_000);
}

type Scored = { candidate: Candidate; confidence: number; rule: MatchRule | null };

// Best rule score for one candidate against one bank line. Returns the highest
// applicable confidence; `rule` is null for proposal-only (sub-threshold)
// signals that should never auto-match but are useful to surface.
function scoreCandidate(line: BankLine, c: Candidate, target: number, opts: Required<MatchOptions>): Scored {
  const exact = Math.abs(c.outstanding - target) <= 0.005; // to the cent
  const rounding = Math.abs(c.outstanding - target) <= opts.amountTolerance;
  const dd = daysBetween(c.date, line.date);
  const inWindow = dd <= opts.dateWindowDays;
  const refEq = !!(line.reference && line.reference.trim() && c.number && norm(c.number) === norm(line.reference));

  // Strongest first.
  if (refEq && exact) return { candidate: c, confidence: 1.0, rule: "reference_exact" };
  if (refEq && rounding) return { candidate: c, confidence: 0.97, rule: "reference_exact" };
  if (exact && dd === 0) return { candidate: c, confidence: 0.97, rule: "amount_date_exact" };
  if (exact && inWindow) return { candidate: c, confidence: 0.95, rule: "amount_within_window" };
  if (rounding && inWindow) return { candidate: c, confidence: 0.9, rule: "amount_rounding" };

  // Proposal-only signals (below threshold → exception, but worth surfacing).
  if (refEq) return { candidate: c, confidence: 0.5, rule: null }; // ref matches, amount disagrees
  if (exact) return { candidate: c, confidence: 0.6, rule: null }; // amount matches, date out of window
  return { candidate: c, confidence: 0, rule: null };
}

export function matchBankLine(
  line: BankLine,
  candidates: Candidate[],
  options: MatchOptions = {}
): MatchDecision {
  const opts: Required<MatchOptions> = { ...DEFAULTS, ...options };

  const dir: "ar" | "ap" | null = line.amount > 0 ? "ar" : line.amount < 0 ? "ap" : null;
  if (!dir) return { kind: "exception", reason: "zero-amount bank line", proposed: null };
  const target = Math.abs(line.amount);

  const pool = candidates.filter((c) => c.direction === dir && c.outstanding > 0.005);
  if (pool.length === 0) {
    return { kind: "exception", reason: `no open ${dir} candidate for RM${target.toFixed(2)}`, proposed: null };
  }

  const scored = pool
    .map((c) => scoreCandidate(line, c, target, opts))
    .filter((s) => s.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (scored.length === 0) {
    return { kind: "exception", reason: `no rule matched ${dir} RM${target.toFixed(2)} on ${line.date}`, proposed: null };
  }

  const top = scored[0];

  // A unique exact-reference hit is decisive: the reference pins the exact
  // document, so it wins even if other candidates coincidentally match on
  // amount/date. Only collapse to ambiguity when two share the same reference.
  const refHits = scored.filter((s) => s.rule === "reference_exact");
  if (refHits.length === 1) {
    const w = refHits[0];
    return {
      kind: "matched",
      candidateId: w.candidate.id,
      candidateType: w.candidate.type,
      amountMatched: Math.min(target, w.candidate.outstanding),
      confidence: w.confidence,
      rule: w.rule!,
    };
  }
  if (refHits.length > 1) {
    return {
      kind: "exception",
      reason: `reference "${line.reference}" matches ${refHits.length} candidates`,
      proposed: null,
    };
  }

  // No reference disambiguator — fall back to amount/date tiers.
  const atThreshold = scored.filter((s) => s.rule !== null && s.confidence >= opts.autoThreshold);

  // Auto-match only when exactly one candidate clears the bar.
  if (atThreshold.length === 1) {
    const winner = atThreshold[0];
    return {
      kind: "matched",
      candidateId: winner.candidate.id,
      candidateType: winner.candidate.type,
      amountMatched: Math.min(target, winner.candidate.outstanding),
      confidence: winner.confidence,
      rule: winner.rule!,
    };
  }

  if (atThreshold.length > 1) {
    // Genuine ambiguity — pick the closest-dated as the proposal, never auto-post.
    const best = atThreshold
      .slice()
      .sort((a, b) => daysBetween(a.candidate.date, line.date) - daysBetween(b.candidate.date, line.date))[0];
    return {
      kind: "exception",
      reason: `${atThreshold.length} candidates match RM${target.toFixed(2)} within ${opts.dateWindowDays}d`,
      proposed: { candidateId: best.candidate.id, candidateType: best.candidate.type, confidence: 0.7 },
    };
  }

  // Below threshold — surface the best near-miss for the inbox / LLM pass.
  return {
    kind: "exception",
    reason: `best candidate for ${dir} RM${target.toFixed(2)} scored ${top.confidence.toFixed(2)} (< ${opts.autoThreshold})`,
    proposed: { candidateId: top.candidate.id, candidateType: top.candidate.type, confidence: top.confidence },
  };
}
