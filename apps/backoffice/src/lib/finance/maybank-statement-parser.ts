// Maybank Islamic SME statement parser.
//
// Maybank only issues these as PDFs. We extract the page text (via `pdftotext
// -layout` in the local watcher, or pdfjs row-reconstruction on the server —
// see maybank-pdf-extract.ts) and parse it here. This function is PURE: text
// in, structured statement out, no PDF/IO dependency, so it's fully unit
// testable against captured fixtures.
//
// Layout (one transaction):
//
//   01/05            TRANSFER FR A/C                 50.50-        22,833.67
//                      COLLECTIVE PROJECT *
//                      IV-01990
//                      CelsiusCoffee N
//
// - First line: ENTRY DATE (DD/MM), description, AMOUNT with a TRAILING sign
//   (`-` = outflow/debit, `+` = inflow/credit), then the running STATEMENT
//   BALANCE. The sign is authoritative — the "TRANSFER TO/FR" wording is not
//   (a "TRANSFER TO A/C ... 31.80+" is an incoming DuitNow QR collection).
// - Following indented lines (no date) are description continuations and may
//   resume AFTER a page break (Maybank repeats a ~20-line header/footer on
//   every page), so we track header/footer zones rather than flushing on gaps.
// - The statement has no totals line; ending balance = last running balance,
//   and we derive total in/out by summing. The running-balance column gives a
//   per-line integrity check: prevBalance + signedAmount == thisBalance.

import type { ParsedLine } from "./bank-statement-parser";

export type MaybankParsedStatement = {
  accountNumber: string | null;
  accountName: string | null;
  statementDate: string | null; // YYYY-MM-DD (statement end date)
  beginningBalance: number | null;
  endingBalance: number | null;
  totalInflows: number;
  totalOutflows: number;
  periodStart: string | null;
  periodEnd: string | null;
  rowsParsed: number;
  reconciled: boolean; // beginning + Σ signed == ending, and every line's balance walk ties
  warnings: string[];
  lines: ParsedLine[];
};

// Amounts/balances may omit the leading zero for sub-RM1 values (".95") and an
// overdrawn balance carries a trailing "DR" (= negative). Both appear in real
// statements; missing either silently dropped whole transactions.
const MONEY = String.raw`[\d,]*\.\d{2}`;
// A transaction's first line: leading DD/MM, description, amount+sign, then the
// running balance with an optional DR/CR overdraft marker. The optional spaces
// before the sign / DR marker tolerate PDF text extractors (pdfjs) that split
// "50.50-" into separate "50.50" and "-" items; `pdftotext -layout` keeps them
// joined, so this is a no-op there.
const TXN_RE = new RegExp(
  String.raw`^\s*(\d{2})/(\d{2})\s+(.*?)\s+(${MONEY})\s?([+-])\s+(${MONEY})\s?(DR|CR)?\s*$`
);

function toNum(s: string): number {
  return Math.round(parseFloat(s.replace(/,/g, "")) * 100) / 100;
}

// Description fragments are Maybank-truncated (≤ ~20 chars, often ending "*").
// Capping length cleanly excludes the end-of-statement announcement sentences
// (stamp duty notices etc.) that share the transaction zone on the last pages.
function cleanFragment(s: string): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/\*+$/, "").trim();
  return t;
}
function isUsableFragment(t: string): boolean {
  return t.length >= 2 && t.length <= 30 && /[A-Za-z0-9]/.test(t);
}

function isPageStart(line: string): boolean {
  return /Maybank Islamic Berhad|Dataran Maybank/.test(line);
}
// The English column-header row marks the start of a page's transaction zone.
function isColumnHeader(line: string): boolean {
  return /ENTRY DATE|STATEMENT BALANCE|TRANSACTION DESCRIPTION/.test(line);
}
// Footer / notes block — ends the transaction zone for the page.
function isFooterStart(line: string): boolean {
  return /BAKI LEGAR|LEDGER BALANCE|Perhatian \/ Note/.test(line);
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseMaybankStatementText(
  text: string,
  opts: { accountNumber?: string; statementDate?: string } = {}
): MaybankParsedStatement {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];

  // ── Header fields ──────────────────────────────────────────
  // Statement date is the only DD/MM/YY (with year) in the doc; txn dates are DD/MM.
  let statementDate = opts.statementDate ?? null;
  if (!statementDate) {
    const m = text.match(/\b(\d{2})\/(\d{2})\/(\d{2})\b/);
    if (m) statementDate = ymd(2000 + parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10));
  }
  let accountNumber = opts.accountNumber ?? null;
  if (!accountNumber) {
    const m = text.match(/\b(\d{12})\b/);
    if (m) accountNumber = m[1];
  }
  let accountName: string | null = null;
  for (const raw of lines) {
    if (/\bSDN\.?\s*BHD\b|\bENTERPRISE\b|\bRESOURCES\b|\bTRADING\b/i.test(raw) && !/MAYBANK/i.test(raw)) {
      accountName = raw.trim().replace(/\s+/g, " ");
      break;
    }
  }

  const stmtYear = statementDate ? parseInt(statementDate.slice(0, 4), 10) : new Date().getUTCFullYear();
  const stmtMonth = statementDate ? parseInt(statementDate.slice(5, 7), 10) : 12;
  // Resolve a DD/MM transaction date's year: same-year normally; if the month
  // is after the statement month, it belongs to the prior calendar year
  // (statements that straddle Dec→Jan).
  const resolveYear = (mm: number): number => (mm > stmtMonth ? stmtYear - 1 : stmtYear);

  // ── Walk lines ─────────────────────────────────────────────
  type Draft = { day: number; month: number; year: number; descParts: string[]; amount: number; direction: "CR" | "DR"; balance: number };
  const drafts: Draft[] = [];
  let beginningBalance: number | null = null;
  let inTxnZone = false;
  let cur: Draft | null = null;

  const flush = () => {
    if (cur) drafts.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    if (isPageStart(raw)) {
      inTxnZone = false;
      continue;
    }
    if (isColumnHeader(raw)) {
      inTxnZone = true;
      continue;
    }
    if (isFooterStart(raw)) {
      inTxnZone = false;
      continue;
    }
    if (!inTxnZone) continue;

    if (/BEGINNING BALANCE/i.test(raw)) {
      const m = raw.match(new RegExp(`(${MONEY})(DR|CR)?\\s*$`));
      if (m) beginningBalance = m[2] === "DR" ? -toNum(m[1]) : toNum(m[1]);
      flush();
      continue;
    }

    const m = raw.match(TXN_RE);
    if (m) {
      flush();
      const day = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const descHead = cleanFragment(m[3]);
      cur = {
        day,
        month,
        year: resolveYear(month),
        descParts: descHead ? [descHead] : [],
        amount: toNum(m[4]),
        direction: m[5] === "+" ? "CR" : "DR",
        balance: m[7] === "DR" ? -toNum(m[6]) : toNum(m[6]),
      };
      continue;
    }

    // Continuation fragment for the current transaction.
    if (cur && cur.descParts.length < 6) {
      const frag = cleanFragment(raw);
      if (isUsableFragment(frag)) cur.descParts.push(frag);
    }
  }
  flush();

  // ── Build lines + reconcile against the running-balance column ──
  const parsed: ParsedLine[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let running = beginningBalance;
  let walkOk = beginningBalance !== null;

  for (const d of drafts) {
    const signed = d.direction === "CR" ? d.amount : -d.amount;
    if (running !== null) {
      const expected = Math.round((running + signed) * 100) / 100;
      if (Math.abs(expected - d.balance) > 0.01) {
        walkOk = false;
        if (warnings.length < 5) {
          warnings.push(
            `Balance walk mismatch at ${ymd(d.year, d.month, d.day)} "${d.descParts.join(" ")}": ` +
              `expected ${expected.toFixed(2)} but statement shows ${d.balance.toFixed(2)}`
          );
        }
      }
      running = d.balance; // trust the statement's column; resync after any drift
    }

    if (d.direction === "CR") totalIn += d.amount;
    else totalOut += d.amount;

    const date = ymd(d.year, d.month, d.day);
    if (!periodStart || date < periodStart) periodStart = date;
    if (!periodEnd || date > periodEnd) periodEnd = date;

    parsed.push({
      txnDate: date,
      description: d.descParts.join(" ").trim(),
      reference: null,
      amount: d.amount,
      direction: d.direction,
      balance: d.balance,
    });
  }

  const endingBalance = drafts.length ? drafts[drafts.length - 1].balance : beginningBalance;
  const reconciled =
    walkOk &&
    beginningBalance !== null &&
    endingBalance !== null &&
    Math.abs(
      Math.round((beginningBalance + totalIn - totalOut) * 100) / 100 - endingBalance
    ) <= 0.01;

  if (!reconciled && beginningBalance !== null && endingBalance !== null && warnings.length < 6) {
    warnings.push(
      `Statement does not reconcile: ${beginningBalance.toFixed(2)} + ${totalIn.toFixed(2)} in − ` +
        `${totalOut.toFixed(2)} out = ${(beginningBalance + totalIn - totalOut).toFixed(2)}, ` +
        `but ending balance is ${endingBalance.toFixed(2)}.`
    );
  }
  if (beginningBalance === null) warnings.push("No BEGINNING BALANCE row found — cannot reconcile.");
  if (drafts.length === 0) warnings.push("No transactions parsed — check the extracted text format.");

  return {
    accountNumber,
    accountName,
    statementDate,
    beginningBalance,
    endingBalance,
    totalInflows: Math.round(totalIn * 100) / 100,
    totalOutflows: Math.round(totalOut * 100) / 100,
    periodStart,
    periodEnd,
    rowsParsed: parsed.length,
    reconciled,
    warnings,
    lines: parsed,
  };
}
