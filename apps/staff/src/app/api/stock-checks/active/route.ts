import { NextResponse, NextRequest } from "next/server";
import { autoRefreshOnExpiry, evaluateCountFreshness, evaluateCountSchedule } from "@celsius/db";
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

  // "Today" is the MALAYSIA day, not the server's UTC one. Vercel runs UTC, so
  // server-local midnight is 08:00 MYT — squarely inside opening hours — which
  // made a count finalized at 7am stop being "today's" at 8:01am, and yesterday's
  // show as today's between midnight and 8am. Anchor the window to MYT (+08:00).
  const mytToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const dayStart = new Date(`${mytToday}T00:00:00+08:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  let active = await prisma.stockCount.findFirst({
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

  // Daily auto-refresh: an expired DAILY draft is never resumed — the app
  // opens on a fresh sheet instead of a days-old count nobody can finalize.
  // The draft itself is left alone (evidence of what was counted); the items
  // endpoint creates a new one on the first save. Judged from countDate so a
  // deliberately continued (re-dated) draft stays resumable for its new day.
  if (
    active &&
    autoRefreshOnExpiry(frequency as "DAILY" | "WEEKLY" | "MONTHLY") &&
    evaluateCountFreshness({ createdAt: active.countDate, now: new Date() }).expired
  ) {
    active = null;
  }

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

  // Expiry state for the resumed draft. A count open more than a full day is
  // no longer a single-date snapshot, so the app must prompt before letting
  // anyone count on into it — surfaced here so the prompt appears on open
  // rather than after the first quantity is keyed and rejected. Judged from
  // countDate (same rule as the items endpoint): a draft that was continued
  // and re-dated today must not prompt again.
  const freshness = active
    ? evaluateCountFreshness({ createdAt: active.countDate, now: new Date() })
    : null;

  // Whether today is this frequency's scheduled day. Returned regardless of
  // whether a count is open so the app can say "the weekly is due Thursday"
  // BEFORE someone walks 256 shelves — the finalize guard would otherwise be
  // the first time they hear it.
  const schedule = evaluateCountSchedule({
    frequency: frequency as "DAILY" | "WEEKLY" | "MONTHLY",
    date: new Date(),
  });

  return NextResponse.json({
    active: active
      ? {
          ...active,
          expired: freshness!.expired,
          hoursOpen: Math.round(freshness!.hoursOpen),
          daysOpen: freshness!.daysOpen,
        }
      : null,
    submittedToday,
    schedule: {
      onSchedule: schedule.onSchedule,
      offSchedule: schedule.offSchedule,
      expectedLabel: schedule.expectedLabel,
      actualLabel: schedule.actualLabel,
    },
  });
}
