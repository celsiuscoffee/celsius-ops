type Shift = {
  start_time: string;
  end_time: string;
};

/**
 * Minimum concurrent staff count within a slot — the floor of how many
 * people are simultaneously on duty at any moment inside [slotStart, slotEnd).
 *
 * Coverage rules describe a *standing requirement*: "always have N people".
 * A morning-only shift plus a closing-only shift with no overlap covers the
 * day with only 1 person at any given moment, even though 2 unique staff
 * worked that day.
 */
export function minConcurrentInSlot(
  shifts: Shift[],
  slotStart: string,
  slotEnd: string,
): number {
  type Event = { time: string; delta: number };
  const events: Event[] = [];

  for (const s of shifts) {
    const start = s.start_time > slotStart ? s.start_time : slotStart;
    const end = s.end_time < slotEnd ? s.end_time : slotEnd;
    if (start >= end) continue;
    events.push({ time: start, delta: 1 });
    events.push({ time: end, delta: -1 });
  }

  if (events.length === 0) return 0;

  // Sort by time; at the same timestamp, process +1 before -1 so a clean
  // handoff (one ends exactly when another starts) doesn't dip to a false
  // zero in between events.
  events.sort((a, b) => (a.time === b.time ? b.delta - a.delta : a.time < b.time ? -1 : 1));

  let current = 0;
  let min = Infinity;
  let prevTime = slotStart;

  for (const e of events) {
    if (e.time > prevTime && current < min) min = current;
    current += e.delta;
    prevTime = e.time;
  }
  if (prevTime < slotEnd && current < min) min = current;

  return min === Infinity ? 0 : min;
}
