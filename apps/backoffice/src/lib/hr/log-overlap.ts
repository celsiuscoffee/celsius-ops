// Overlapping attendance logs must not pay the same minutes twice.
//
// Nothing upstream prevents two logs covering the same span: the observed
// shape is a manager adding a manual round-time log NEXT TO the original tap
// log instead of correcting it (three full-shift pairs in July 2026, ~8h of
// overlap each), plus device-retry duplicates. pickShiftWindow hands every log
// the same rostered window with no depletion, so each overlapping log would
// price its full overlap — a duplicated shift pays double and the confirm
// screen shows two plausible rows.
//
// The rule here: each user's logs CLAIM their clocked span in a deterministic
// order, and a later claim is clipped to the part of its span nobody has
// claimed yet (keeping the earliest remaining piece). Claim order is
// manager-adjusted logs first — `final_status: "adjusted"` is written only by
// human actions (set_times / adjust), so where a manual correction coexists
// with the original tap log, the manager's version wins and the tap log clips
// to leftovers — then chronological.
//
// A fully-swallowed log clips to zero length; paidWindowHours pays a
// zero-length span 0 with needsSignOff, so the duplicate lands in the manager
// queue instead of the payroll.

export type OverlapLog = {
  clock_in: string;
  clock_out: string | null;
  final_status?: string | null;
};

export type ClippedLog<T> = {
  log: T;
  /** Effective span to price — clipped past any span already claimed. */
  clockIn: Date;
  clockOut: Date;
  /** Minutes of the raw span excluded because another log already claimed them. */
  trimmedMinutes: number;
};

export function clipOverlappingLogs<T extends OverlapLog>(logs: T[]): ClippedLog<T>[] {
  const claimOrder = [...logs].sort((a, b) => {
    const aAdj = a.final_status === "adjusted" ? 0 : 1;
    const bAdj = b.final_status === "adjusted" ? 0 : 1;
    if (aAdj !== bAdj) return aAdj - bAdj;
    return new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime();
  });

  const claimed: Array<{ start: number; end: number }> = [];
  const out: ClippedLog<T>[] = [];

  for (const log of claimOrder) {
    const rawIn = new Date(log.clock_in).getTime();
    const rawOut = new Date(log.clock_out ?? log.clock_in).getTime();

    // 1. Push the start forward past any claim that covers it. Repeat — moving
    //    past one claim can land inside another.
    let inMs = Math.min(rawIn, rawOut);
    let moved = true;
    while (moved) {
      moved = false;
      for (const c of claimed) {
        if (c.start <= inMs && inMs < c.end) {
          inMs = c.end;
          moved = true;
        }
      }
    }
    // 2. Cap the end at the first claim that begins inside what remains, so the
    //    result is the earliest unclaimed piece of the raw span.
    let outMs = rawOut;
    for (const c of claimed) {
      if (c.start >= inMs && c.start < outMs) outMs = c.start;
    }
    if (outMs < inMs) outMs = inMs; // fully swallowed → zero-length

    if (outMs > inMs) claimed.push({ start: inMs, end: outMs });

    const rawSpan = Math.max(0, rawOut - rawIn);
    const kept = Math.max(0, outMs - inMs);
    out.push({
      log,
      clockIn: new Date(inMs),
      clockOut: new Date(outMs),
      trimmedMinutes: Math.round((rawSpan - kept) / 60000),
    });
  }

  // Hand back in chronological order of the effective span so downstream
  // consumption (the per-day approved-OT budget) is deterministic.
  return out.sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
}
