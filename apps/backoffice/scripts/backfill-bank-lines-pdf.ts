/* eslint-disable @typescript-eslint/no-require-imports */
// Backfill BankStatementLine rows from Maybank PDF statements.
//
// Strategy: shell out to `pdftotext -layout`, then parse the columnar
// output. Maybank PDF transaction blocks are typically 4 lines:
//
//   "    DD/MM    DESCRIPTION_LINE_1                ...   AMOUNT[+-]   BALANCE"
//   "                                                vendor name      "
//   "                                                reference no     "
//   "                                                outlet hint      "
//
// Trailing "+" on the amount = credit (money in), "-" = debit (money out).
// Some single-line types (e.g. "CMS - CR PYMT MARS") have no continuation.
//
// Year resolution: filename ends YYYY-MM-DD (period end). Most rows are
// within the same calendar month, but a Jan statement may include
// "31/12" rows from December — those get the previous year.
//
// Usage:
//   cd apps/backoffice
//   ../../node_modules/.bin/tsx scripts/backfill-bank-lines-pdf.ts

import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { classifyBankLine } from "../src/lib/finance/bank-line-classifier";

const prisma = new PrismaClient();

// Maybank account number → BankStatement.accountName mapping
const ACCOUNT_MAP: Record<string, string> = {
  "562263574384": "Maybank CCSB (HQ - 4384)",
  "562263659345": "Maybank CCT (Tamarind - 9345)",
  "562263662644": "Maybank CCC (Conezion - 2644)",
};

// Roots to scan recursively for MBBcurrent_*_YYYY-MM-DD.pdf
const PDF_ROOT = path.resolve(process.env.HOME!, "Desktop/Celsius Coffee/Claude Reports/Maybank Bank Statement");

function findPdfs(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && /^MBBcurrent_\d+_\d{4}-\d{2}-\d{2}/.test(e.name)) out.push(p);
    }
  }
  return out;
}

function parsePdfFilename(filename: string): { accountNo: string; periodEnd: Date } | null {
  const m = filename.match(/MBBcurrent_(\d+)_(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return {
    accountNo: m[1],
    periodEnd: new Date(Date.UTC(parseInt(m[2], 10), parseInt(m[3], 10) - 1, parseInt(m[4], 10))),
  };
}

type ParsedLine = {
  txnDate: Date;
  description: string;
  reference: string | null;
  amount: number;
  direction: "CR" | "DR";
};

function parseAmount(s: string): number {
  return parseFloat(s.replace(/,/g, ""));
}

function parsePdfText(text: string, statementYear: number, statementMonth: number): ParsedLine[] {
  const lines = text.split(/\r?\n/);
  // Match a transaction header row:
  //    DD/MM    DESCRIPTION_TEXT (variable)   AMOUNT(+/-)   BALANCE
  // The amount has trailing + (credit) or - (debit). Balance has no sign
  // unless the account is overdrawn (rare).
  const HEADER_RE = /^\s{2,}(\d{2})\/(\d{2})\s+(.+?)\s+([\d,]+\.\d{2})([+\-])\s+([\d,]+\.\d{2})\s*$/;
  // Continuation rows: heavily-indented text, no leading date column.
  const CONT_RE = /^\s{20,}(\S.*?)\s*$/;

  const out: ParsedLine[] = [];
  let pending: ParsedLine | null = null;
  let pendingDescParts: string[] = [];

  const flush = () => {
    if (pending) {
      pending.description = pendingDescParts.join(" ").replace(/\s+/g, " ").trim();
      // Heuristic: the second-to-last continuation line (when present)
      // is usually the reference number — pull it out.
      const parts = pendingDescParts;
      if (parts.length >= 2) {
        // Try to detect a reference from parts[1] — alphanumeric refs
        // like "INV-2509253", "144672", "365IN2512-0074".
        const candidate = parts[1].trim();
        if (/^[A-Z0-9][A-Z0-9_/\-.]+$/i.test(candidate) && candidate.length >= 4) {
          pending.reference = candidate;
        }
      }
      out.push(pending);
    }
    pending = null;
    pendingDescParts = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const h = ln.match(HEADER_RE);
    if (h) {
      flush();
      const day = parseInt(h[1], 10);
      const month = parseInt(h[2], 10);
      // Year handling: most rows match statementMonth/statementYear.
      // When the row's month > statementMonth (e.g. Dec 31 row in a
      // January statement), it's the previous year.
      let year = statementYear;
      if (month > statementMonth) year = statementYear - 1;
      // Sanity: future-dated rows shouldn't appear; if month < statementMonth - 11
      // we'd cross a year boundary the other way (rare, ignore for now).
      const txnDate = new Date(Date.UTC(year, month - 1, day));
      const amount = parseAmount(h[4]);
      const sign = h[5];
      const direction: "CR" | "DR" = sign === "+" ? "CR" : "DR";
      pending = {
        txnDate,
        description: "",
        reference: null,
        amount,
        direction,
      };
      pendingDescParts = [h[3].trim()];
      continue;
    }
    const c = ln.match(CONT_RE);
    if (c && pending) {
      const t = c[1].trim();
      // Skip footer/header noise that sometimes leaks through:
      if (/^(BAKI|LEDGER|ENDING BALANCE|BEGINNING BALANCE|TOTAL DEBIT|TOTAL CREDIT|MUKA|TARIKH|NOMBOR|BUTIR|TRANSACTION|ENTRY|VALUE|JUMLAH|银碼|=|Wang|Overdrawn|PROTECTED|NOT|If|To)/i.test(t)) {
        continue;
      }
      // Skip lines that are mostly punctuation/equals
      if (/^[=\-_*\s]+$/.test(t)) continue;
      pendingDescParts.push(t);
      continue;
    }
    // Blank line — keep pending alive (continuations may resume after)
  }
  flush();

  return out;
}

async function main() {
  const pdfs = findPdfs(PDF_ROOT);
  console.log(`Found ${pdfs.length} PDFs under ${PDF_ROOT}`);

  // Build outlet code → id map once
  const outlets = await prisma.outlet.findMany({ select: { id: true, code: true } });
  const codeToId = new Map(outlets.map((o) => [o.code, o.id]));

  let totalInserted = 0;
  let totalSkippedNoStatement = 0;

  for (const pdfPath of pdfs.sort()) {
    const meta = parsePdfFilename(path.basename(pdfPath));
    if (!meta) { console.warn(`[skip] unparseable filename ${pdfPath}`); continue; }
    const accountName = ACCOUNT_MAP[meta.accountNo];
    if (!accountName) { console.warn(`[skip] no account map for ${meta.accountNo}`); continue; }

    // Find the matching BankStatement (use periodEnd from filename to
    // map to the statement record — same period mapping the totals were
    // ingested with).
    const periodStart = new Date(Date.UTC(meta.periodEnd.getUTCFullYear(), meta.periodEnd.getUTCMonth(), 1));
    const statement = await prisma.bankStatement.findFirst({
      where: { accountName, periodStart },
      select: { id: true, accountName: true, periodStart: true, periodEnd: true },
    });
    if (!statement) {
      console.warn(`[skip] no BankStatement for ${accountName} ${periodStart.toISOString().slice(0,10)}`);
      totalSkippedNoStatement++;
      continue;
    }

    // Wipe any pre-existing lines for idempotency so re-runs always
    // reflect the current classifier rules.
    const wiped = await prisma.bankStatementLine.deleteMany({ where: { statementId: statement.id } });
    if (wiped.count > 0) console.log(`[reset] dropped ${wiped.count} existing lines for ${statement.accountName} ${periodStart.toISOString().slice(0,10)}`);

    // pdftotext --layout for columnar preservation
    const tmpFile = `/tmp/maybank-pdf-${Date.now()}.txt`;
    try {
      execFileSync("pdftotext", ["-layout", pdfPath, tmpFile], { stdio: "ignore" });
    } catch (err) {
      console.warn(`[skip] pdftotext failed for ${pdfPath}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const text = fs.readFileSync(tmpFile, "utf-8");
    fs.unlinkSync(tmpFile);

    const statementYear = meta.periodEnd.getUTCFullYear();
    const statementMonth = meta.periodEnd.getUTCMonth() + 1;
    const parsed = parsePdfText(text, statementYear, statementMonth);

    if (parsed.length === 0) {
      console.warn(`[empty] ${accountName} ${periodStart.toISOString().slice(0,10)} — no parseable transactions in PDF`);
      continue;
    }

    type LineData = {
      statementId: string;
      txnDate: Date;
      description: string;
      reference: string | null;
      amount: number;
      direction: "CR" | "DR";
      category: string | null;
      outletId: string | null;
      isInterCo: boolean;
      classifiedBy: string;
      ruleName: string;
    };

    const data: LineData[] = parsed.map((p) => {
      const cls = classifyBankLine({
        description: p.description,
        reference: p.reference,
        amount: p.amount,
        direction: p.direction,
        accountKey: accountName,
      });
      return {
        statementId: statement.id,
        txnDate: p.txnDate,
        description: p.description,
        reference: p.reference,
        amount: p.amount,
        direction: p.direction,
        category: cls.category,
        outletId: cls.outletCode ? codeToId.get(cls.outletCode) ?? null : null,
        isInterCo: cls.isInterCo,
        classifiedBy: "rule",
        ruleName: cls.ruleName,
      };
    });

    const result = await prisma.bankStatementLine.createMany({ data: data as never });
    totalInserted += result.count;
    console.log(`[ok] ${accountName} ${periodStart.toISOString().slice(0,10)}: parsed ${parsed.length} txns, inserted ${result.count}`);
  }

  // Summary by category × month
  const summary = await prisma.bankStatementLine.groupBy({
    by: ["category", "direction"],
    _count: { _all: true },
    _sum: { amount: true },
  });
  console.log("\n--- Category summary (all months) ---");
  for (const s of summary.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? ""))) {
    const dir = s.direction === "CR" ? "in " : "out";
    const amt = Number(s._sum.amount ?? 0);
    console.log(`  ${dir} ${(s.category ?? "—").padEnd(28)} ${String(s._count._all).padStart(5)}  RM ${amt.toFixed(2)}`);
  }

  console.log(`\nTotal inserted: ${totalInserted}, statements without record: ${totalSkippedNoStatement}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
