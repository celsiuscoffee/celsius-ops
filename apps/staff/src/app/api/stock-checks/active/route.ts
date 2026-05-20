import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

/**
 * GET /api/stock-checks/active?frequency=MONTHLY
 *
 * Returns the in-progress (DRAFT) count for the user's outlet + frequency
 * if one exists, with all items so the frontend can hydrate. Also returns
 * the most recent SUBMITTED count for the same outlet+frequency today —
 * the UI uses that to decide whether to show a "Start new count" CTA.
 *
 * Shape:
 *   { active: StockCount | null, submittedToday: StockCount | null }
 *
 * `active` includes items + per-item counter user; `submittedToday` is
 * lightweight (no items) and only set when there's no active draft (i.e.
 * the user already finished today's count).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const frequency = req.nextUrl.searchParams.get("frequency");
  if (!frequency) {
    return NextResponse.json({ error: "frequency required" }, { status: 400 });
  }
  if (!session.outletId) {
    return NextResponse.json({ error: "No outlet on session" }, { status: 400 });
  }

  // "Today" in server time. Good enough for Malaysia (UTC+8) where one
  // outlet's day boundary doesn't realistically straddle UTC midnight
  // during work hours. If we ever serve outlets across multiple TZs we
  // can stamp countDate using outlet timezone.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const active = await prisma.stockCount.findFirst({
    where: {
      outletId: session.outletId,
      frequency: frequency as "DAILY" | "WEEKLY" | "MONTHLY",
      status: "DRAFT",
      // No date filter — a DRAFT can span across midnight if the count
      // started late. Picking the only open draft is unambiguous because
      // we enforce one-DRAFT-at-a-time via the find-or-create logic on
      // the items endpoint.
    },
    include: {
      countedBy: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          productId: true,
          productPackageId: true,
          countedQty: true,
          isConfirmed: true,
          countedById: true,
          countedAt: true,
          countedBy: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // If no active draft, surface the most recent SUBMITTED count from today
  // so the UI can show "today's count is done" instead of a blank slate.
  const submittedToday = active
    ? null
    : await prisma.stockCount.findFirst({
        where: {
          outletId: session.outletId,
          frequency: frequency as "DAILY" | "WEEKLY" | "MONTHLY",
          status: { in: ["SUBMITTED", "REVIEWED"] },
          submittedAt: { gte: dayStart, lt: dayEnd },
        },
        select: {
          id: true,
          submittedAt: true,
          finalizedAt: true,
          finalizedBy: { select: { name: true } },
          countedBy: { select: { name: true } },
        },
        orderBy: { submittedAt: "desc" },
      });

  return NextResponse.json({ active, submittedToday });
}
