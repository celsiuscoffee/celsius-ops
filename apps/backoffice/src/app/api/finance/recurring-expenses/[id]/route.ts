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

  const data: Record<string, unknown> = {};
  if (typeof b.name === "string") data.name = b.name;
  if (typeof b.category === "string") data.category = b.category;
  if (b.amount != null) data.amount = Number(b.amount);
  if (typeof b.cadence === "string") data.cadence = b.cadence;
  if (typeof b.nextDueDate === "string") data.nextDueDate = new Date(b.nextDueDate);
  if (b.outletId === null || typeof b.outletId === "string") data.outletId = (b.outletId as string | null) || null;
  if (typeof b.isActive === "boolean") data.isActive = b.isActive;
  if (b.notes === null || typeof b.notes === "string") data.notes = (b.notes as string | null) || null;

  try {
    const updated = await prisma.recurringExpense.update({
      where: { id },
      data,
      include: { outlet: { select: { id: true, name: true, code: true } } },
    });
    return NextResponse.json({ ...updated, amount: Number(updated.amount) });
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
  await prisma.recurringExpense.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
