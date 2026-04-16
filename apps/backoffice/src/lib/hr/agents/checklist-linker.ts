import { hrSupabaseAdmin } from "../supabase";
import { prisma } from "@/lib/prisma";

type LinkResult = {
  checklistsCreated: number;
  notes: string[];
};

/**
 * Checklist-Schedule Linker
 *
 * When a schedule is published, auto-create checklist instances
 * for each shift assignment based on matching SopSchedules.
 *
 * Maps shift times to Prisma Shift enum:
 * - start before 12:00 → OPENING
 * - start 12:00-14:59 → MIDDAY
 * - start 15:00+ → CLOSING
 */
export async function linkChecklistsToSchedule(scheduleId: string): Promise<LinkResult> {
  const result: LinkResult = { checklistsCreated: 0, notes: [] };

  // 1. Get the schedule and its shifts
  const { data: schedule } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("*")
    .eq("id", scheduleId)
    .single();

  if (!schedule) {
    result.notes.push("Schedule not found");
    return result;
  }

  const { data: shifts } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("*")
    .eq("schedule_id", scheduleId);

  if (!shifts || shifts.length === 0) {
    result.notes.push("No shifts in this schedule");
    return result;
  }

  // 2. Get all active SopSchedules for this outlet
  const sopSchedules = await prisma.sopSchedule.findMany({
    where: {
      outletId: schedule.outlet_id,
      isActive: true,
    },
    include: {
      sop: { select: { id: true, title: true, status: true } },
    },
  });

  if (sopSchedules.length === 0) {
    result.notes.push("No active SOP schedules for this outlet");
    return result;
  }

  // 3. For each shift assignment, create matching checklists
  for (const shift of shifts) {
    const shiftEnum = mapTimeToShiftEnum(shift.start_time);
    const shiftDate = new Date(shift.shift_date + "T00:00:00Z");
    const dayOfWeek = shiftDate.getDay(); // 0=Sun
    const dayNum = dayOfWeek === 0 ? 7 : dayOfWeek; // 1=Mon...7=Sun

    // Find matching SopSchedules for this shift type + day
    const matchingSops = sopSchedules.filter((ss) => {
      if (ss.shift !== shiftEnum) return false;
      if (ss.sop.status !== "PUBLISHED") return false;
      // Check day of week
      if (ss.daysOfWeek.length > 0 && !ss.daysOfWeek.includes(dayNum)) return false;
      // Check date range
      if (ss.startDate && shiftDate < ss.startDate) return false;
      if (ss.endDate && shiftDate > ss.endDate) return false;
      return true;
    });

    for (const sopSchedule of matchingSops) {
      // Check if checklist already exists for this sop + outlet + date + shift
      const existing = await prisma.checklist.findFirst({
        where: {
          sopId: sopSchedule.sopId,
          outletId: schedule.outlet_id,
          date: shiftDate,
          shift: shiftEnum,
        },
      });

      if (existing) {
        // Update assignee if different
        if (existing.assignedToId !== shift.user_id) {
          await prisma.checklist.update({
            where: { id: existing.id },
            data: { assignedToId: shift.user_id },
          });
          result.notes.push(`Updated ${sopSchedule.sop.title} on ${shift.shift_date} → ${shift.user_id.slice(0, 8)}`);
        }
        continue;
      }

      // Create checklist with items from the SOP template
      const sopSteps = await prisma.sopStep.findMany({
        where: { sopId: sopSchedule.sopId },
        orderBy: { stepNumber: "asc" },
      });

      // Calculate due time
      let dueAt: Date | undefined;
      if (sopSchedule.dueMinutes > 0 && sopSchedule.times.length > 0) {
        const [h, m] = sopSchedule.times[0].split(":").map(Number);
        dueAt = new Date(shiftDate);
        dueAt.setUTCHours(h, m + sopSchedule.dueMinutes, 0, 0);
      }

      await prisma.checklist.create({
        data: {
          sopId: sopSchedule.sopId,
          outletId: schedule.outlet_id,
          assignedToId: shift.user_id,
          date: shiftDate,
          shift: shiftEnum,
          timeSlot: sopSchedule.times[0] || null,
          dueAt,
          status: "PENDING",
          items: {
            create: sopSteps.map((step, idx) => ({
              stepNumber: idx + 1,
              title: step.title,
              description: step.description,
              photoRequired: step.photoRequired,
            })),
          },
        },
      });

      result.checklistsCreated++;
    }
  }

  result.notes.push(`${result.checklistsCreated} checklists created from ${sopSchedules.length} SOP schedules`);
  return result;
}

/** Map shift start_time (HH:MM) to Prisma Shift enum */
function mapTimeToShiftEnum(startTime: string): "OPENING" | "MIDDAY" | "CLOSING" {
  const hour = parseInt(startTime.split(":")[0], 10);
  if (hour < 12) return "OPENING";
  if (hour < 15) return "MIDDAY";
  return "CLOSING";
}
