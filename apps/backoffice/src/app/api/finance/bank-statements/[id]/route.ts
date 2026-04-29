import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;

  // Only allow editing the fields that finance commonly needs to fix —
  // closing balance, period totals, InterCo offsets, notes. Statement
  // date / account name are immutable to keep audit trail.
  const data: Record<string, unknown> = {};
  const numericOrNull = (v: unknown) => v == null || v === "" ? null : Number(v);
  const dateOrNull = (v: unknown) => typeof v === "string" && v ? new Date(v) : null;

  if ("closingBalance" in b) data.closingBalance = numericOrNull(b.closingBalance) ?? 0;
  if ("totalInflows" in b)    data.totalInflows = numericOrNull(b.totalInflows);
  if ("totalOutflows" in b)   data.totalOutflows = numericOrNull(b.totalOutflows);
  if ("interCoInflows" in b)  data.interCoInflows = numericOrNull(b.interCoInflows);
  if ("interCoOutflows" in b) data.interCoOutflows = numericOrNull(b.interCoOutflows);
  if ("periodStart" in b)     data.periodStart = dateOrNull(b.periodStart);
  if ("periodEnd" in b)       data.periodEnd = dateOrNull(b.periodEnd);
  if (typeof b.notes === "string" || b.notes === null) data.notes = (b.notes as string | null) || null;

  try {
    const updated = await prisma.bankStatement.update({
      where: { id },
      data,
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json({
      ...updated,
      closingBalance: Number(updated.closingBalance),
      totalInflows: updated.totalInflows == null ? null : Number(updated.totalInflows),
      totalOutflows: updated.totalOutflows == null ? null : Number(updated.totalOutflows),
      interCoInflows: updated.interCoInflows == null ? null : Number(updated.interCoInflows),
      interCoOutflows: updated.interCoOutflows == null ? null : Number(updated.interCoOutflows),
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRole(req.headers, "ADMIN"); }
  catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }
  const { id } = await params;
  await prisma.bankStatement.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
