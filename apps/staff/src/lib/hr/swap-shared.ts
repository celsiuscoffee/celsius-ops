// Shared shape for the two swap routes. hr_schedule_shifts has NO outlet_id —
// the outlet (and publish status) live on the parent hr_schedules row, so both
// come through the join. Same pattern as the backoffice shift-swaps route.
export const SWAPPABLE_SELECT =
  "id, user_id, shift_date, start_time, end_time, role_type, notes, hr_schedules!inner(outlet_id, status)";

export type SwappableShiftRow = {
  id: string;
  user_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role_type: string | null;
  notes: string | null;
  hr_schedules:
    | { outlet_id: string; status: string | null }
    | { outlet_id: string; status: string | null }[]
    | null;
};

export type SwappableShift = {
  id: string;
  user_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role_type: string | null;
  notes: string | null;
  outlet_id: string | null;
  status: string | null;
};

export function flattenSwappable(s: SwappableShiftRow): SwappableShift {
  const sched = Array.isArray(s.hr_schedules) ? s.hr_schedules[0] : s.hr_schedules;
  return {
    id: s.id,
    user_id: s.user_id,
    shift_date: s.shift_date,
    start_time: s.start_time,
    end_time: s.end_time,
    role_type: s.role_type ?? null,
    notes: s.notes ?? null,
    outlet_id: sched?.outlet_id ?? null,
    status: sched?.status ?? null,
  };
}

// A "Rest Day" roster row (00:00–00:00, or labelled as rest) is not a shift
// anyone can take over. Same rule My Shifts uses to hide them.
export function isRestRow(s: { start_time: string; end_time: string; role_type: string | null }): boolean {
  const rt = (s.role_type ?? "").toLowerCase();
  if (rt.includes("rest")) return true;
  return s.start_time.slice(0, 5) === "00:00" && s.end_time.slice(0, 5) === "00:00";
}
