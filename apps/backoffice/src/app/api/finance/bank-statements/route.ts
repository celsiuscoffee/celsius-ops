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
    statements.map((s) => ({ ...s, closingBalance: Number(s.closingBalance) })),
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
  const { accountName, statementDate, closingBalance, fileUrl, notes } = (body ?? {}) as {
    accountName?: string | null; statementDate?: string;
    closingBalance?: number | string; fileUrl?: string | null; notes?: string | null;
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
      fileUrl: fileUrl || null,
      notes: notes || null,
      uploadedById: caller.id,
    },
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  return NextResponse.json(
    { ...created, closingBalance: Number(created.closingBalance) },
    { status: 201 },
  );
}
