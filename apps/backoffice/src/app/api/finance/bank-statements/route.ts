import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";

// Bank statements are uploaded periodically by Finance — typically weekly.
// The most recent row is the opening balance for the cashflow projection.

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
  } = (body ?? {}) as {
    accountName?: string | null; statementDate?: string;
    closingBalance?: number | string; fileUrl?: string | null; notes?: string | null;
    periodStart?: string | null; periodEnd?: string | null;
    totalInflows?: number | string | null; totalOutflows?: number | string | null;
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
      totalInflows: totalInflows == null || totalInflows === "" ? null : Number(totalInflows),
      totalOutflows: totalOutflows == null || totalOutflows === "" ? null : Number(totalOutflows),
      fileUrl: fileUrl || null,
      notes: notes || null,
      uploadedById: caller.id,
    },
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  return NextResponse.json(
    {
      ...created,
      closingBalance: Number(created.closingBalance),
      totalInflows: created.totalInflows == null ? null : Number(created.totalInflows),
      totalOutflows: created.totalOutflows == null ? null : Number(created.totalOutflows),
    },
    { status: 201 },
  );
}
