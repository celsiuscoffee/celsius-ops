// Persists a parsed Maybank statement into BankStatement + BankStatementLine,
// auto-classifying every line into a CashCategory. Shared by the ingest API
// route (admin upload / watcher) and the one-off backfill script, so behaviour
// is identical across both paths.
//
// Idempotent: keyed on (accountName label, statementDate). Re-ingesting the
// same statement replaces its lines rather than duplicating — safe for cron
// retries and re-runs.

import { classifyBankLine } from "./bank-line-classifier";
import type { MaybankParsedStatement } from "./maybank-statement-parser";
import type { PrismaClient } from "@celsius/db";

export type PersistOptions = {
  uploadedById: string;
  fileUrl?: string | null;
  sourceFileName?: string | null;
};

export type PersistResult = {
  statementId: string;
  accountName: string;
  statementDate: string;
  created: boolean; // false => replaced an existing statement
  linesCreated: number;
  totalInflows: number;
  totalOutflows: number;
  interCoInflows: number;
  interCoOutflows: number;
  closingBalance: number;
  reconciled: boolean;
  warnings: string[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Stable display + dedupe label, e.g. "CELSIUS COFFEE SDN. BHD. (4384)".
export function accountLabel(parsed: MaybankParsedStatement): string {
  const last4 = parsed.accountNumber ? parsed.accountNumber.slice(-4) : "????";
  const name = (parsed.accountName ?? "Maybank").replace(/\s+/g, " ").trim();
  return `${name} (${last4})`;
}

export async function persistMaybankStatement(
  prisma: PrismaClient,
  parsed: MaybankParsedStatement,
  opts: PersistOptions
): Promise<PersistResult> {
  if (!parsed.statementDate) throw new Error("Cannot persist: statement date not found in PDF.");
  const label = accountLabel(parsed);
  const stmtDate = new Date(`${parsed.statementDate}T00:00:00.000Z`);
  const closingBalance = parsed.endingBalance ?? parsed.beginningBalance ?? 0;

  const outlets = await prisma.outlet.findMany({ select: { id: true, code: true } });
  const codeToId = new Map(outlets.map((o) => [o.code, o.id]));

  const lineData = parsed.lines
    .filter((l) => l.amount > 0 && (l.direction === "CR" || l.direction === "DR"))
    .map((l) => {
      const cls = classifyBankLine({
        description: l.description,
        reference: l.reference ?? null,
        amount: l.amount,
        direction: l.direction,
        accountKey: label,
      });
      return {
        txnDate: new Date(`${l.txnDate}T00:00:00.000Z`),
        description: l.description,
        reference: l.reference ?? null,
        amount: l.amount,
        direction: l.direction,
        category: cls.category,
        outletId: cls.outletCode ? codeToId.get(cls.outletCode) ?? null : null,
        isInterCo: cls.isInterCo,
        classifiedBy: "rule",
        ruleName: cls.ruleName,
      };
    });

  const interCoInflows = round2(
    lineData.filter((d) => d.isInterCo && d.direction === "CR").reduce((s, d) => s + d.amount, 0)
  );
  const interCoOutflows = round2(
    lineData.filter((d) => d.isInterCo && d.direction === "DR").reduce((s, d) => s + d.amount, 0)
  );

  const notes =
    (parsed.reconciled ? "Auto-ingested from Maybank PDF (reconciled)." : "⚠️ Auto-ingested but did NOT reconcile.") +
    (opts.sourceFileName ? ` Source: ${opts.sourceFileName}.` : "") +
    (parsed.warnings.length ? ` ${parsed.warnings.slice(0, 3).join(" | ")}` : "");

  const header = {
    closingBalance,
    periodStart: parsed.periodStart ? new Date(`${parsed.periodStart}T00:00:00.000Z`) : null,
    periodEnd: parsed.periodEnd ? new Date(`${parsed.periodEnd}T00:00:00.000Z`) : null,
    totalInflows: parsed.totalInflows,
    totalOutflows: parsed.totalOutflows,
    interCoInflows,
    interCoOutflows,
    fileUrl: opts.fileUrl ?? null,
    notes,
  };

  // Idempotent upsert keyed on (label, statementDate).
  const existing = await prisma.bankStatement.findFirst({
    where: { accountName: label, statementDate: stmtDate },
    select: { id: true },
  });

  let statementId: string;
  let created: boolean;
  // Carried state for a re-upload rebuild: GL stamps, AP-match links,
  // expense-month overrides and human classifications must survive the
  // delete+recreate, or (a) the GL poster re-posts already-posted lines —
  // additively double-counting a partially rebuilt day — and (b) user state
  // silently reverts. Same occurrence-queue mechanism as bukku-feed-sync's
  // rebuild (keyed by date|direction|amount|description; duplicates restore
  // in creation order).
  type CarriedLine = {
    txnDate: Date; direction: string; amount: unknown; description: string;
    category: string | null; classifiedBy: string | null; ruleName: string | null;
    isInterCo: boolean; outletId: string | null;
    glTransactionId: string | null; glPostedAt: Date | null;
    apInvoiceId: string | null; apMatchedAt: Date | null;
    expenseMonth: string | null;
  };
  const lineKey = (l: { txnDate: Date; direction: string; amount: unknown; description: string }) =>
    `${l.txnDate.toISOString().slice(0, 10)}|${l.direction}|${Number(l.amount).toFixed(2)}|${l.description}`;
  const carry = new Map<string, CarriedLine[]>();
  if (existing) {
    const oldLines = (await prisma.bankStatementLine.findMany({
      where: { statementId: existing.id },
      select: {
        txnDate: true, amount: true, direction: true, description: true,
        category: true, classifiedBy: true, ruleName: true, isInterCo: true, outletId: true,
        glTransactionId: true, glPostedAt: true, apInvoiceId: true, apMatchedAt: true,
        expenseMonth: true,
      },
      orderBy: [{ txnDate: "asc" }, { id: "asc" }],
    })) as CarriedLine[];
    for (const l of oldLines) {
      const k = lineKey(l);
      const q = carry.get(k);
      if (q) q.push(l); else carry.set(k, [l]);
    }
  }
  if (existing) {
    await prisma.bankStatementLine.deleteMany({ where: { statementId: existing.id } });
    await prisma.bankStatement.update({ where: { id: existing.id }, data: header });
    statementId = existing.id;
    created = false;
  } else {
    const c = await prisma.bankStatement.create({
      data: { accountName: label, statementDate: stmtDate, uploadedById: opts.uploadedById, ...header },
      select: { id: true },
    });
    statementId = c.id;
    created = true;
  }

  let linesCreated = 0;
  const rows = lineData.map((d) => ({ ...d, statementId }));
  for (let i = 0; i < rows.length; i += 1000) {
    const r = await prisma.bankStatementLine.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
    linesCreated += r.count;
  }

  // Restore carried state onto the recreated lines (batched by identical
  // payload — most stamped lines share a glTransactionId).
  if (carry.size) {
    const fresh = await prisma.bankStatementLine.findMany({
      where: { statementId },
      select: { id: true, txnDate: true, amount: true, direction: true, description: true },
      orderBy: [{ txnDate: "asc" }, { id: "asc" }],
    });
    type CarryData = Record<string, unknown>;
    const batches = new Map<string, { data: CarryData; ids: string[] }>();
    for (const nl of fresh) {
      const old = carry.get(lineKey(nl))?.shift();
      if (!old) continue;
      const data: CarryData = {};
      if (old.glTransactionId) { data.glTransactionId = old.glTransactionId; data.glPostedAt = old.glPostedAt; }
      if (old.apInvoiceId) { data.apInvoiceId = old.apInvoiceId; data.apMatchedAt = old.apMatchedAt; }
      if (old.expenseMonth) { data.expenseMonth = old.expenseMonth; }
      if (old.classifiedBy && old.classifiedBy !== "rule") {
        data.category = old.category; data.classifiedBy = old.classifiedBy; data.ruleName = old.ruleName;
        data.isInterCo = old.isInterCo; data.outletId = old.outletId;
      }
      if (!Object.keys(data).length) continue;
      const bk = JSON.stringify(data);
      const b = batches.get(bk);
      if (b) b.ids.push(nl.id); else batches.set(bk, { data, ids: [nl.id] });
    }
    for (const b of batches.values()) {
      await prisma.bankStatementLine.updateMany({ where: { id: { in: b.ids } }, data: b.data });
    }
  }

  return {
    statementId,
    accountName: label,
    statementDate: parsed.statementDate,
    created,
    linesCreated,
    totalInflows: parsed.totalInflows,
    totalOutflows: parsed.totalOutflows,
    interCoInflows,
    interCoOutflows,
    closingBalance,
    reconciled: parsed.reconciled,
    warnings: parsed.warnings,
  };
}
