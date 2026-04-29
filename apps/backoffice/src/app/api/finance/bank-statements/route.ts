import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";
import { classifyBankLine } from "@/lib/finance/bank-line-classifier";

// Bank statements are uploaded periodically by Finance — typically weekly.
// The most recent row is the opening balance for the cashflow projection.
// When CSV/XLSX lines are forwarded from the parser, each row is auto-
// classified into a CashCategory and persisted as a BankStatementLine —
// these power the cash-tracking matrix and the per-category projection.

type IncomingLine = {
  txnDate: string;
  description: string;
  reference: string | null;
  amount: number;
  direction: "CR" | "DR";
};

export async function GET(req: NextRequest) {
  try { await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const statements = await prisma.bankStatement.findMany({
    orderBy: { statementDate: "desc" },
    take: 50,
    include: { uploadedBy: { select: { id: true, name: true } } },
  });
  return NextResponse.json(
    statements.map((s) => ({
      ...s,
      closingBalance: Number(s.closingBalance),
      totalInflows: s.totalInflows == null ? null : Number(s.totalInflows),
      totalOutflows: s.totalOutflows == null ? null : Number(s.totalOutflows),
      interCoInflows: s.interCoInflows == null ? null : Number(s.interCoInflows),
      interCoOutflows: s.interCoOutflows == null ? null : Number(s.interCoOutflows),
    })),
  );
}

export async function POST(req: NextRequest) {
  let caller;
  try { caller = await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const {
    accountName, statementDate, closingBalance, fileUrl, notes,
    periodStart, periodEnd, totalInflows, totalOutflows,
    interCoInflows, interCoOutflows, lines,
  } = (body ?? {}) as {
    accountName?: string | null; statementDate?: string;
    closingBalance?: number | string; fileUrl?: string | null; notes?: string | null;
    periodStart?: string | null; periodEnd?: string | null;
    totalInflows?: number | string | null; totalOutflows?: number | string | null;
    interCoInflows?: number | string | null; interCoOutflows?: number | string | null;
    lines?: IncomingLine[];
  };

  if (!statementDate || closingBalance == null) {
    return NextResponse.json(
      { error: "statementDate and closingBalance are required" },
      { status: 400 },
    );
  }

  const created = await prisma.bankStatement.create({
    data: {
      accountName: accountName || null,
      statementDate: new Date(statementDate),
      closingBalance: Number(closingBalance),
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
      interCoInflows: interCoInflows == null || interCoInflows === "" ? null : Number(interCoInflows),
      interCoOutflows: interCoOutflows == null || interCoOutflows === "" ? null : Number(interCoOutflows),
      totalInflows: totalInflows == null || totalInflows === "" ? null : Number(totalInflows),
      totalOutflows: totalOutflows == null || totalOutflows === "" ? null : Number(totalOutflows),
      fileUrl: fileUrl || null,
      notes: notes || null,
      uploadedById: caller.id,
    },
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  // Classify + persist lines if the parser forwarded any. Best-effort —
  // a failure here doesn't roll back the statement (Finance can re-upload
  // or hand-classify in the cash-tracking edit UI).
  let linesCreated = 0;
  if (Array.isArray(lines) && lines.length > 0) {
    // Map outlet codes once up front
    const outlets = await prisma.outlet.findMany({ select: { id: true, code: true } });
    const codeToId = new Map(outlets.map((o) => [o.code, o.id]));

    const data = lines
      .filter((l) => l && l.txnDate && l.amount > 0 && (l.direction === "CR" || l.direction === "DR"))
      .map((l) => {
        const cls = classifyBankLine({
          description: l.description ?? "",
          reference: l.reference ?? null,
          amount: l.amount,
          direction: l.direction,
          accountKey: accountName ?? undefined,
        });
        return {
          statementId: created.id,
          txnDate: new Date(l.txnDate),
          description: l.description ?? "",
          reference: l.reference ?? null,
          amount: Number(l.amount),
          direction: l.direction,
          category: cls.category,
          outletId: cls.outletCode ? codeToId.get(cls.outletCode) ?? null : null,
          isInterCo: cls.isInterCo,
          classifiedBy: "rule",
          ruleName: cls.ruleName,
        };
      });

    if (data.length > 0) {
      const result = await prisma.bankStatementLine.createMany({ data, skipDuplicates: true });
      linesCreated = result.count;
    }
  }

  return NextResponse.json(
    {
      ...created,
      closingBalance: Number(created.closingBalance),
      totalInflows: created.totalInflows == null ? null : Number(created.totalInflows),
      totalOutflows: created.totalOutflows == null ? null : Number(created.totalOutflows),
      interCoInflows: created.interCoInflows == null ? null : Number(created.interCoInflows),
      interCoOutflows: created.interCoOutflows == null ? null : Number(created.interCoOutflows),
      linesCreated,
    },
    { status: 201 },
  );
}
