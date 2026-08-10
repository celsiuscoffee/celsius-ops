import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// Today's date string in MYT (the outlet-local calendar day).
export function todayMytDateStr(): string {
  const myt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return myt.toISOString().split("T")[0];
}

/**
 * Generate a day's checklists for one outlet. Shared by:
 *  - POST /api/checklists/generate (tab-open, kept as a catch-up/backstop)
 *  - GET  /api/cron/generate-checklists (00:15 MYT daily — the primary path,
 *    so the day's tasks exist from the start of the day instead of whenever
 *    someone first opens the Checklists tab; before the cron, outlets where
 *    nobody opened the tab got NO checklists at all, and late opens created
 *    morning tasks hours past due, outside the nudge window)
 *
 * Two sources:
 * 1. SOP + SopOutlet (auto) — creates unassigned checklists anyone can claim
 * 2. SopSchedule (manual) — creates assigned checklists for specific staff
 *
 * Idempotent: existing rows block re-creation, and the unique index catches
 * concurrent racers.
 */
export async function generateChecklistsForOutlet(
  outletId: string,
  dateStr = todayMytDateStr(),
): Promise<number> {
  // Date string is the MYT local date (e.g. "2026-04-11"). Parse directly as
  // UTC date components — do NOT convert via timezone offset because that
  // shifts the UTC date back by one day.
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dateOnly = new Date(Date.UTC(y, mo - 1, d));
  const jsDay = dateOnly.getUTCDay();
  const dayOfWeek = jsDay === 0 ? 7 : jsDay;

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { openTime: true, closeTime: true },
  });
  const openHour = parseInt(outlet?.openTime?.split(":")[0] || "8");
  const closeHour = parseInt(outlet?.closeTime?.split(":")[0] || "22");

  let created = 0;

  // ─── Source 1: Auto-generate from SOP + SopOutlet (unassigned) ───
  const publishedSops = await prisma.sop.findMany({
    where: {
      status: "PUBLISHED",
      sopOutlets: { some: { outletId } },
    },
    include: { steps: { orderBy: { stepNumber: "asc" } } },
  });

  for (const sop of publishedSops) {
    // Skip if SOP has day-of-week restrictions and today isn't one of them
    if (sop.expectedDaysOfWeek && sop.expectedDaysOfWeek.length > 0) {
      if (!sop.expectedDaysOfWeek.includes(dayOfWeek)) continue;
    }

    // Check if this SOP has specific staff schedules — if so, skip auto-generate
    const hasSchedules = await prisma.sopSchedule.count({
      where: { sopId: sop.id, outletId, isActive: true },
    });
    if (hasSchedules > 0) continue; // Will be handled by Source 2

    // Determine time slots from SOP's expected frequency
    const timeSlots = getTimeSlots(sop.expectedRecurrence, sop.expectedTimes, sop.expectedTimesPerDay, openHour, closeHour);

    for (const timeSlot of timeSlots) {
      const slotValue = timeSlot || null;
      const dueAt = calcDueAt(dateOnly, timeSlot, sop.expectedDueMinutes);
      const shift = getShiftFromTime(timeSlot);

      // ANY existing row for this (sop, outlet, date, slot) blocks re-creation —
      // regardless of owner or status. The check used to require
      // assignedToId: null, but the auto-assign cron SETS assignedToId, so the
      // next tab-open no longer matched the row and re-created the task: every
      // assign→open cycle minted a duplicate (32 dupes in the 30 days to
      // 2026-07-11, 16 of them phantom-PENDING next to a completed sibling,
      // dragging owners' completion % and the RM80 checklist allowance).
      const existing = await prisma.checklist.findFirst({
        where: { sopId: sop.id, outletId, date: dateOnly, timeSlot: slotValue },
      });
      if (existing) continue;

      try {
        await prisma.checklist.create({
          data: {
            sopId: sop.id, outletId, assignedToId: null, // anyone can claim
            date: dateOnly, shift, timeSlot: slotValue, dueAt,
            items: {
              create: sop.steps.map((step) => ({
                stepNumber: step.stepNumber, title: step.title,
                description: step.description, photoRequired: step.photoRequired,
              })),
            },
          },
        });
        created++;
      } catch (e) {
        // Concurrent generate request created the same row first — safe to skip.
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }

  // ─── Source 2: Generate from SopSchedule (assigned to specific staff) ───
  const schedules = await prisma.sopSchedule.findMany({
    where: {
      outletId, isActive: true, daysOfWeek: { has: dayOfWeek },
      OR: [{ startDate: null }, { startDate: { lte: dateOnly } }],
      AND: [{ OR: [{ endDate: null }, { endDate: { gte: dateOnly } }] }],
      sop: { status: "PUBLISHED" },
    },
    include: {
      sop: { include: { steps: { orderBy: { stepNumber: "asc" } } } },
    },
  });

  for (const schedule of schedules) {
    const timeSlots = getTimeSlots(
      schedule.recurrence,
      schedule.times,
      schedule.times.length || 1,
      openHour, closeHour,
    );

    for (const timeSlot of timeSlots) {
      const slotValue = timeSlot || null;
      const dueAt = calcDueAt(dateOnly, timeSlot, schedule.dueMinutes);

      const existing = await prisma.checklist.findFirst({
        where: {
          sopId: schedule.sopId, outletId, date: dateOnly,
          shift: schedule.shift, assignedToId: schedule.assignedToId,
          timeSlot: slotValue,
        },
      });
      if (existing) continue;

      try {
        await prisma.checklist.create({
          data: {
            sopId: schedule.sopId, outletId,
            assignedToId: schedule.assignedToId,
            date: dateOnly, shift: schedule.shift,
            timeSlot: slotValue, dueAt,
            items: {
              create: schedule.sop.steps.map((step) => ({
                stepNumber: step.stepNumber, title: step.title,
                description: step.description, photoRequired: step.photoRequired,
              })),
            },
          },
        });
        created++;
      } catch (e) {
        // Concurrent generate request created the same row first — safe to skip.
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }

  return created;
}

// ─── Helpers ───

function getTimeSlots(
  recurrence: string, times: string[], count: number,
  openHour: number, closeHour: number,
): string[] {
  switch (recurrence) {
    case "SPECIFIC_TIMES":
      return times.length > 0 ? times : [""];
    case "HOURLY":
      return Array.from({ length: closeHour - openHour }, (_, i) =>
        `${(openHour + i).toString().padStart(2, "0")}:00`
      );
    case "SHIFT":
    default:
      return [""]; // no time slot
  }
}

function calcDueAt(dateOnly: Date, timeSlot: string, dueMinutes: number): Date | null {
  if (!timeSlot) return null;
  const [h, m] = timeSlot.split(":").map(Number);
  // SOP times are in Malaysia Time (UTC+8). Convert to UTC for storage.
  const totalMytMinutes = h * 60 + m + (dueMinutes || 60);
  const utcMinutes = totalMytMinutes - 480; // MYT is UTC+8 = 480 min
  const due = new Date(dateOnly);
  due.setUTCHours(0, 0, 0, 0);
  due.setTime(due.getTime() + utcMinutes * 60000);
  return due;
}

function getShiftFromTime(timeSlot: string): "OPENING" | "MIDDAY" | "CLOSING" {
  if (!timeSlot) return "OPENING";
  const hour = parseInt(timeSlot.split(":")[0]);
  if (hour < 12) return "OPENING";
  if (hour < 17) return "MIDDAY";
  return "CLOSING";
}
