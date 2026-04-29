/* eslint-disable @typescript-eslint/no-require-imports */
// One-shot backfill — reads the 3 Maybank pipe-delimited CSV exports,
// classifies each line, and inserts into BankStatementLine for the
// matching April 2026 BankStatement records.
//
// Usage:
//   cd apps/backoffice
//   pnpm dlx tsx scripts/backfill-bank-lines.ts
//
// Maybank CSV format (pipe-delimited, 22 columns):
//   BATCH DATE | ACCOUNT NO. | PROD TYPE | EFFECT DATE | EFFECT TIME |
//   BRANCH | TELLER | CODE | SOURCE CODE | AMOUNT | AMOUNT IND |
//   TRX DESCRIPTION | TRX REFERENCE | STD REF IND | STD REF1..3 | FILLER1..5
//
// Amount is sen, padded to 15 digits (000000000005201 = RM 52.01).

import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";

import { classifyBankLine } from "../src/lib/finance/bank-line-classifier";

const prisma = new PrismaClient();

// Account number → BankStatement period filter (account name)
const ACCOUNT_MAP: Record<string, { accountName: string }> = {
  "0000562263574384": { accountName: "Maybank CCSB (HQ - 4384)" },
  "0000562263659345": { accountName: "Maybank CCT (Tamarind - 9345)" },
  "0000562263662644": { accountName: "Maybank CCC (Conezion - 2644)" },
};

const CSV_FILES: Array<{ path: string; accountNo: string }> = [
  { path: path.resolve(process.env.HOME!, "Downloads/ACCOUNTACTIVITYREPORT_562263574384 CCSB.csv"), accountNo: "0000562263574384" },
  { path: path.resolve(process.env.HOME!, "Downloads/ACCOUNTACTIVITYREPORT_562263659345 CCT.csv"),  accountNo: "0000562263659345" },
  { path: path.resolve(process.env.HOME!, "Downloads/ACCOUNTACTIVITYREPORT_562263662644 CCC.csv"),  accountNo: "0000562263662644" },
];

function parseDateYYYYMMDD(s: string): Date | null {
  if (!/^\d{8}$/.test(s)) return null;
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(4, 6), 10) - 1;
  const d = parseInt(s.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m, d));
  return isNaN(dt.getTime()) ? null : dt;
}

function parseSenAmount(s: string): number {
  // Strip leading zeros, divide by 100 to get RM.
  const n = parseInt(s.replace(/^0+/, "") || "0", 10);
  return n / 100;
}

async function main() {
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const csv of CSV_FILES) {
    if (!fs.existsSync(csv.path)) {
      console.warn(`[skip] missing ${csv.path}`);
      continue;
    }
    const accountInfo = ACCOUNT_MAP[csv.accountNo];
    if (!accountInfo) {
      console.warn(`[skip] no account map for ${csv.accountNo}`);
      continue;
    }

    // Find the April 2026 BankStatement for this account.
    const statement = await prisma.bankStatement.findFirst({
      where: {
        accountName: accountInfo.accountName,
        periodStart: new Date("2026-04-01"),
      },
      select: { id: true, accountName: true },
    });
    if (!statement) {
      console.warn(`[skip] no April 2026 BankStatement for ${accountInfo.accountName}`);
      continue;
    }

    // Wipe any pre-existing lines for idempotency.
    const wiped = await prisma.bankStatementLine.deleteMany({ where: { statementId: statement.id } });
    if (wiped.count > 0) console.log(`[reset] dropped ${wiped.count} existing lines for ${statement.accountName}`);

    const text = fs.readFileSync(csv.path, "utf-8");
    const rows = text.split(/\r?\n/);

    // Outlet code → id lookup (cache once).
    const outlets = await prisma.outlet.findMany({ select: { id: true, code: true } });
    const codeToId = new Map(outlets.map((o) => [o.code, o.id]));

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
    const data: LineData[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      // Skip header
      if (row.startsWith("BATCH DATE")) continue;

      const cols = row.split("|");
      if (cols.length < 13) continue;

      const effectDate = parseDateYYYYMMDD(cols[3]);
      if (!effectDate) continue;
      const amount = parseSenAmount(cols[9]);
      if (amount <= 0) continue;
      const ind = cols[10]?.trim();
      const direction: "CR" | "DR" = ind === "CR" ? "CR" : ind === "DR" ? "DR" : (() => { throw new Error(`unknown ind ${ind}`); })();
      const description = (cols[11] ?? "").trim();
      const reference = (cols[12] ?? "").trim() || null;

      const cls = classifyBankLine({
        description,
        reference,
        amount,
        direction,
        accountKey: accountInfo.accountName,
      });

      data.push({
        statementId: statement.id,
        txnDate: effectDate,
        description,
        reference,
        amount,
        direction,
        category: cls.category,
        outletId: cls.outletCode ? (codeToId.get(cls.outletCode) ?? null) : null,
        isInterCo: cls.isInterCo,
        classifiedBy: "rule",
        ruleName: cls.ruleName,
      });
    }

    if (data.length === 0) {
      console.log(`[empty] ${statement.accountName} — no parseable lines`);
      continue;
    }

    // createMany doesn't accept enum strings without coercion — fine in this
    // raw shape since Prisma will validate on insert.
    const result = await prisma.bankStatementLine.createMany({ data: data as never });
    totalInserted += result.count;
    totalSkipped += (data.length - result.count);
    console.log(`[ok] ${statement.accountName}: inserted ${result.count} lines (${data.length - result.count} skipped)`);
  }

  // Summary by category
  const summary = await prisma.bankStatementLine.groupBy({
    by: ["category", "direction"],
    _count: { _all: true },
    _sum: { amount: true },
  });
  console.log("\n--- Category summary ---");
  for (const s of summary.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? ""))) {
    const dir = s.direction === "CR" ? "in " : "out";
    const amt = Number(s._sum.amount ?? 0);
    console.log(`  ${dir} ${(s.category ?? "—").padEnd(28)} ${String(s._count._all).padStart(5)}  RM ${amt.toFixed(2)}`);
  }

  console.log(`\nTotal inserted: ${totalInserted}, skipped: ${totalSkipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
