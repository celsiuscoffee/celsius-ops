import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = req.nextUrl;
  const outletId = url.searchParams.get("outletId");
  const date = url.searchParams.get("date");
  const shift = url.searchParams.get("shift");
  const status = url.searchParams.get("status");
  const assignedToId = url.searchParams.get("assignedToId");
  const mine = url.searchParams.get("mine");

  const where: Record<string, unknown> = {};
  if (outletId) where.outletId = outletId;
  if (shift) where.shift = shift;
  if (status) where.status = status;
  if (assignedToId) where.assignedToId = assignedToId;
  if (mine === "true") where.assignedToId = session.id;
  if (date) {
    // Date string is MYT local date (e.g. "2026-04-11").
    // Parse directly as UTC date — do NOT use timezone offset which shifts the date.
    const [y, mo, d] = date.split("-").map(Number);
    where.date = new Date(Date.UTC(y, mo - 1, d));
  }

  // Single query — include item completion counts inline.
  // `items` (where: isCompleted) gives us the team total completed.
  // We also pull just the completedById so we can count how many were
  // done by the calling user (`myCompletedItems`) — surfaces the
  // individual's contribution on the native list ("X by you / Y total").
  const checklists = await prisma.checklist.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, date: true, shift: true, timeSlot: true, dueAt: true,
      status: true, completedAt: true,
      sop: { select: { id: true, title: true, category: { select: { name: true } } } },
      outlet: { select: { id: true, code: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      completedBy: { select: { id: true, name: true } },
      _count: { select: { items: true } },
      items: {
        where: { isCompleted: true },
        select: { id: true, completedById: true },
      },
    },
  });

  const result = checklists.map(({ items, ...cl }) => {
    const totalItems = cl._count.items;
    const completedItems = items.length;
    const myCompletedItems = items.filter(
      (i) => i.completedById === session.id,
    ).length;
    return {
      ...cl,
      totalItems,
      completedItems,
      myCompletedItems,
      progress: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
    };
  });

  return NextResponse.json(result);
}
