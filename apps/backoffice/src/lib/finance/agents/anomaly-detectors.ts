// Anomaly detectors (pure) — the ledger's continuous self-check.
//
// Each detector takes already-loaded rows and returns findings; the IO shell
// (anomaly.ts) loads the data and raises one fin_exceptions row per finding.
// Deterministic and false-positive-averse on purpose: an anomaly sweep that
// cries wolf trains humans to ignore the inbox. No IO here — unit-tested.
//
// Covered: duplicate bills (same supplier + bill number), out-of-balance
// posted transactions, posted AR/AP transactions missing a source document,
// and bill amount outliers vs the supplier's own history.

export type BillRow = {
  id: string;
  companyId: string | null;
  supplierId: string | null;
  supplierName: string | null;
  billNumber: string | null;
  billDate: string;
  total: number;
  sourceDocId: string | null;
};

export type TxnRow = {
  id: string;
  companyId: string | null;
  txnType: string;
  status: string;
  sourceDocId: string | null;
  sumDebit: number;
  sumCredit: number;
};

export type AnomalyFinding = {
  type: "duplicate" | "out_of_balance" | "missing_doc" | "anomaly";
  relatedType: "bill" | "invoice" | "transaction" | "bank_txn" | "document";
  relatedId: string;
  companyId: string | null;
  reason: string;
  priority: "low" | "normal" | "high" | "urgent";
  proposed?: Record<string, unknown>;
};

// Tuning. Outliers need both a large multiple AND a material absolute jump, so
// a cheap supplier going from RM10 to RM45 doesn't spam the inbox.
const MIN_HISTORY = 5;
const OUTLIER_MULTIPLE = 4;
const OUTLIER_MIN_ABS = 200;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normNumber(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Same supplier + same bill number, seen more than once. The first occurrence
// is canonical; every later one is flagged as a duplicate of it.
export function detectDuplicateBills(bills: BillRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  const firstByKey = new Map<string, string>();
  for (const b of bills) {
    if (!b.supplierId || !b.billNumber || !b.billNumber.trim()) continue;
    const key = `${b.supplierId}|${normNumber(b.billNumber)}`;
    const first = firstByKey.get(key);
    if (first) {
      findings.push({
        type: "duplicate",
        relatedType: "bill",
        relatedId: b.id,
        companyId: b.companyId,
        reason: `Duplicate of bill ${first} — same supplier + bill number "${b.billNumber}"`,
        priority: "high",
        proposed: { duplicateOf: first, billNumber: b.billNumber, total: b.total },
      });
    } else {
      firstByKey.set(key, b.id);
    }
  }
  return findings;
}

// A posted transaction whose journal lines don't balance. The DB trigger should
// make this impossible — this is the belt-and-suspenders integrity check.
export function detectOutOfBalance(txns: TxnRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const t of txns) {
    if (t.status !== "posted") continue;
    if (round2(t.sumDebit) !== round2(t.sumCredit)) {
      findings.push({
        type: "out_of_balance",
        relatedType: "transaction",
        relatedId: t.id,
        companyId: t.companyId,
        reason: `Posted transaction is unbalanced: debit ${t.sumDebit.toFixed(2)} ≠ credit ${t.sumCredit.toFixed(2)}`,
        priority: "urgent",
        proposed: { sumDebit: round2(t.sumDebit), sumCredit: round2(t.sumCredit) },
      });
    }
  }
  return findings;
}

const NEEDS_DOC = new Set(["ap_bill", "ar_invoice"]);

// A posted AR/AP transaction with no source document — revenue/expense booked
// with nothing to back it. Manual journals are exempt (they legitimately have
// no doc).
export function detectMissingDocs(txns: TxnRow[]): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const t of txns) {
    if (t.status !== "posted") continue;
    if (NEEDS_DOC.has(t.txnType) && !t.sourceDocId) {
      findings.push({
        type: "missing_doc",
        relatedType: "transaction",
        relatedId: t.id,
        companyId: t.companyId,
        reason: `Posted ${t.txnType} has no source document`,
        priority: "normal",
      });
    }
  }
  return findings;
}

// A bill far above the supplier's own historical norm. `historyBySupplier` is
// past bill totals for that supplier (excluding the bills under test).
export function detectAmountOutliers(
  bills: BillRow[],
  historyBySupplier: Map<string, number[]>
): AnomalyFinding[] {
  const findings: AnomalyFinding[] = [];
  for (const b of bills) {
    if (!b.supplierId) continue;
    const history = historyBySupplier.get(b.supplierId) ?? [];
    if (history.length < MIN_HISTORY) continue;
    const med = median(history);
    if (med <= 0) continue;
    if (b.total > med * OUTLIER_MULTIPLE && b.total - med > OUTLIER_MIN_ABS) {
      findings.push({
        type: "anomaly",
        relatedType: "bill",
        relatedId: b.id,
        companyId: b.companyId,
        reason:
          `${b.supplierName ?? "Supplier"} bill RM${b.total.toFixed(2)} is ` +
          `${(b.total / med).toFixed(1)}× the median of RM${med.toFixed(2)} ` +
          `over ${history.length} prior bills`,
        priority: "high",
        proposed: { median: round2(med), multiple: round2(b.total / med), historyCount: history.length },
      });
    }
  }
  return findings;
}

export function runDetectors(input: {
  bills: BillRow[];
  txns: TxnRow[];
  historyBySupplier: Map<string, number[]>;
}): AnomalyFinding[] {
  return [
    ...detectDuplicateBills(input.bills),
    ...detectOutOfBalance(input.txns),
    ...detectMissingDocs(input.txns),
    ...detectAmountOutliers(input.bills, input.historyBySupplier),
  ];
}
