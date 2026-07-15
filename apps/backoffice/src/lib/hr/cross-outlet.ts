import { hrSupabaseAdmin } from "./supabase";
import { prisma } from "@/lib/prisma";

const toMin = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
};

export type CrossOutletConflict = {
  outletId: string;
  outletName: string;
  start_time: string;
  end_time: string;
};

// A shared staffer may be rostered at several outlets, but never two shifts at
// the same clock time on the same day. This finds an existing shift the person
// already holds at ANOTHER outlet on `shiftDate` whose window overlaps
// [start, end). Returns the first conflict (with outlet name for the message),
// or null when the slot is free. Rest-day markers (00:00) are ignored.
export async function findCrossOutletOverlap(
  userId: string,
  shiftDate: string,
  outletId: string,
  start: string,
  end: string,
): Promise<CrossOutletConflict | null> {
  const { data } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("start_time, end_time, hr_schedules!inner(outlet_id)")
    .eq("user_id", userId)
    .eq("shift_date", shiftDate)
    .neq("start_time", "00:00");

  const s = toMin(start);
  const e = toMin(end);
  type Row = { start_time: string; end_time: string; hr_schedules: { outlet_id: string } | { outlet_id: string }[] };
  for (const row of ((data ?? []) as unknown as Row[])) {
    const sched = Array.isArray(row.hr_schedules) ? row.hr_schedules[0] : row.hr_schedules;
    if (!sched || sched.outlet_id === outletId) continue; // same outlet is handled by the cell replace
    const rs = toMin(row.start_time);
    const re = toMin(row.end_time);
    if (s < re && rs < e) {
      const outlet = await prisma.outlet.findUnique({ where: { id: sched.outlet_id }, select: { name: true } });
      return {
        outletId: sched.outlet_id,
        outletName: outlet?.name ?? "another outlet",
        start_time: row.start_time.slice(0, 5),
        end_time: row.end_time.slice(0, 5),
      };
    }
  }
  return null;
}
