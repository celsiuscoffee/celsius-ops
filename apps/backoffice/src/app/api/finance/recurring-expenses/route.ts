import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/auth";

// Recurring expenses are HQ-level finance data — restricted to ADMIN/OWNER.
// MANAGER and STAFF must not see consolidated cashflow inputs.

export async function GET(req: NextRequest) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  const showInactive = req.nextUrl.searchParams.get("includeInactive") === "1";
  const expenses = await prisma.recurringExpense.findMany({
    where: showInactive ? {} : { isActive: true },
    include: { outlet: { select: { id: true, name: true, code: true } } },
    orderBy: [{ isActive: "desc" }, { nextDueDate: "asc" }],
  });
  return NextResponse.json(
    expenses.map((e) => ({ ...e, amount: Number(e.amount) }))
  );
}

export async function POST(req: NextRequest) {
  let caller;
  try {
    caller = await requireRole(req.headers, "ADMIN");
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }
  const { name, category, amount, cadence, nextDueDate, outletId, notes } = (body ?? {}) as {
    name?: string; category?: string; amount?: number | string; cadence?: string;
    nextDueDate?: string; outletId?: string | null; notes?: string;
  };

  if (!name || !category || !cadence || amount == null || !nextDueDate) {
    return NextResponse.json(
      { error: "name, category, amount, cadence, nextDueDate are required" },
      { status: 400 },
    );
  }

  const created = await prisma.recurringExpense.create({
    data: {
      name,
      category: category as "RENT" | "UTILITY" | "SAAS" | "PAYROLL_SUPPORT" | "OTHER",
      amount: Number(amount),
      cadence: cadence as "MONTHLY" | "QUARTERLY" | "YEARLY",
      nextDueDate: new Date(nextDueDate),
      outletId: outletId || null,
      notes: notes || null,
    },
    include: { outlet: { select: { id: true, name: true, code: true } } },
  });

  // Touch caller for audit/log if needed later
  void caller;

  return NextResponse.json({ ...created, amount: Number(created.amount) }, { status: 201 });
}
