import { supabaseAdmin } from "@/lib/supabase";

// Where a staff is ACTUALLY working today, so checklists follow the person to
// whatever outlet they're covering — not their fixed home outlet on file.
//
// Why this exists: the staff app used to key checklists off session.outletId
// (the User's home outlet). That broke two real cases:
//   • a staff covering another outlet (home = IOI, working = Putrajaya) saw the
//     wrong list and got 403'd on the checklists they were there to do;
//   • a roving manager / a staff with no home outlet set saw nothing at all and
//     couldn't even auto-generate.
//
// Resolution order for the "working outlet": open clock-in today → any clock-in
// today → today's rostered shift → home outlet. The "allowed" set is the union
// of all of those, and is what the write path checks so a person can only tick
// checklists at an outlet they're clocked into, rostered at, or call home.

const MYT_OFFSET_MS = 8 * 3_600_000;

function mytYmd(now = new Date()): string {
  return new Date(now.getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10);
}

export type WorkingSource = "clockin" | "shift" | "home" | "none";

export interface OutletContext {
  workingOutletId: string | null;
  workingSource: WorkingSource;
  allowedOutletIds: string[];
}

// Outlets the user is rostered at today (published or not — they're on the
// roster there, so they may run its checklists). Outlet lives on the parent
// hr_schedules row, not the shift, so this is a two-step lookup.
async function todaysShiftOutletIds(userId: string, ymd: string): Promise<string[]> {
  const { data: shifts } = await supabaseAdmin
    .from("hr_schedule_shifts")
    .select("schedule_id")
    .eq("user_id", userId)
    .eq("shift_date", ymd);
  const scheduleIds = [...new Set((shifts ?? []).map((s) => s.schedule_id).filter(Boolean))];
  if (scheduleIds.length === 0) return [];
  const { data: scheds } = await supabaseAdmin
    .from("hr_schedules")
    .select("outlet_id")
    .in("id", scheduleIds);
  return [...new Set((scheds ?? []).map((s) => s.outlet_id).filter(Boolean))] as string[];
}

export async function resolveOutletContext(
  userId: string,
  homeOutletId: string | null,
  now = new Date(),
): Promise<OutletContext> {
  const ymd = mytYmd(now);
  const dayStartIso = `${ymd}T00:00:00+08:00`;
  const dayEndIso = `${ymd}T23:59:59+08:00`;

  const [{ data: logs }, shiftOutletIds] = await Promise.all([
    supabaseAdmin
      .from("hr_attendance_logs")
      .select("clock_in, clock_out, outlet_id")
      .eq("user_id", userId)
      .gte("clock_in", dayStartIso)
      .lte("clock_in", dayEndIso)
      .order("clock_in", { ascending: false }),
    todaysShiftOutletIds(userId, ymd),
  ]);

  const todayLogs = (logs ?? []) as { clock_in: string; clock_out: string | null; outlet_id: string | null }[];
  const openLog = todayLogs.find((l) => !l.clock_out && l.outlet_id);
  const anyLog = todayLogs.find((l) => l.outlet_id);

  // Priority for the single "working" outlet: clocked in now → clocked in
  // earlier today → rostered today → home.
  let workingOutletId: string | null = null;
  let workingSource: WorkingSource = "none";
  if (openLog?.outlet_id) { workingOutletId = openLog.outlet_id; workingSource = "clockin"; }
  else if (anyLog?.outlet_id) { workingOutletId = anyLog.outlet_id; workingSource = "clockin"; }
  else if (shiftOutletIds[0]) { workingOutletId = shiftOutletIds[0]; workingSource = "shift"; }
  else if (homeOutletId) { workingOutletId = homeOutletId; workingSource = "home"; }

  const allowed = new Set<string>();
  if (homeOutletId) allowed.add(homeOutletId);
  for (const l of todayLogs) if (l.outlet_id) allowed.add(l.outlet_id);
  for (const id of shiftOutletIds) allowed.add(id);

  return { workingOutletId, workingSource, allowedOutletIds: [...allowed] };
}

// May this user act on checklists for `targetOutletId`? Fast-paths the common
// case (their home outlet) before touching the DB.
export async function isOutletAllowed(
  userId: string,
  homeOutletId: string | null,
  targetOutletId: string,
  now = new Date(),
): Promise<boolean> {
  if (homeOutletId && targetOutletId === homeOutletId) return true;
  const ctx = await resolveOutletContext(userId, homeOutletId, now);
  return ctx.allowedOutletIds.includes(targetOutletId);
}
