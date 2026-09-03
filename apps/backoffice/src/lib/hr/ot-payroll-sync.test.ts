import { describe, it, expect } from "vitest";
import { decideRealLogPatch, pickTargetLog } from "./ot-payroll-sync";

// OT approval used to blind-write final_status='approved' onto whatever real
// attendance log existed that day. Since final_status gates the WHOLE day's
// pay in the monthly calculator, that meant:
//   - approving OT on a day attendance review REJECTED resurrected the full
//     day's pay (regular hours included), and
//   - approving OT on an 'adjusted' log clobbered the manager's stated hours
//     as the weekly pay basis (only 'adjusted' logs pay stated hours).
// decideRealLogPatch is the verdict-preserving rule the sync now applies.

describe("decideRealLogPatch", () => {
  it("refuses to touch a rejected log — attendance review owns the day", () => {
    expect(decideRealLogPatch("rejected")).toEqual({ apply: false });
  });

  it("preserves 'adjusted' — OT hours land but stated-hours basis survives", () => {
    expect(decideRealLogPatch("adjusted")).toEqual({ apply: true, setFinalStatus: null });
  });

  it("approves an unreviewed log (null) — OT sign-off makes the day payable", () => {
    expect(decideRealLogPatch(null)).toEqual({ apply: true, setFinalStatus: "approved" });
    expect(decideRealLogPatch(undefined)).toEqual({ apply: true, setFinalStatus: "approved" });
  });

  it("re-approving an already-approved log is a no-op status-wise", () => {
    expect(decideRealLogPatch("approved")).toEqual({ apply: true, setFinalStatus: "approved" });
  });

  it("pending logs get approved, matching the pre-fix behavior", () => {
    expect(decideRealLogPatch("pending")).toEqual({ apply: true, setFinalStatus: "approved" });
  });
});

// Which real log an approval lands on. The old matcher was "first log on that
// date wins" with no ordering — Zikry (1 Aug 2026) had a real 10h shift AND a
// rejected 6-minute duplicate stub; picking the stub hit the rejected-log
// guard and left his approved hour unpaid.
describe("pickTargetLog", () => {
  const real = { id: "real", clock_in: "2026-08-01T02:17:33Z", clock_out: "2026-08-01T12:18:15Z", final_status: null };
  const stub = { id: "stub", clock_in: "2026-08-01T12:18:21Z", clock_out: "2026-08-01T12:24:03Z", final_status: "rejected" };

  it("never prefers a rejected log — the real shift wins over a rejected stub (either order)", () => {
    expect(pickTargetLog([stub, real], "2026-08-01")?.id).toBe("real");
    expect(pickTargetLog([real, stub], "2026-08-01")?.id).toBe("real");
  });

  it("among usable logs the longest span wins (the shift, not a stray tap)", () => {
    const tap = { id: "tap", clock_in: "2026-08-01T01:00:00Z", clock_out: "2026-08-01T01:05:00Z", final_status: null };
    expect(pickTargetLog([tap, real], "2026-08-01")?.id).toBe("real");
  });

  it("matches on the MYT calendar day, not the UTC date", () => {
    // 31 Jul 16:30Z is 1 Aug 00:30 MYT → same day. 1 Aug 16:30Z is 2 Aug MYT → not.
    const earlyMyt = { id: "early", clock_in: "2026-07-31T16:30:00Z", clock_out: "2026-08-01T02:00:00Z", final_status: null };
    const nextDay = { id: "next", clock_in: "2026-08-01T16:30:00Z", clock_out: "2026-08-02T02:00:00Z", final_status: null };
    expect(pickTargetLog([nextDay, earlyMyt], "2026-08-01")?.id).toBe("early");
    expect(pickTargetLog([nextDay], "2026-08-01")).toBeNull();
  });

  it("when EVERY log that day is rejected, still returns one so the caller surfaces skipped_rejected_log", () => {
    const stub2 = { ...stub, id: "stub2" };
    const picked = pickTargetLog([stub, stub2], "2026-08-01");
    expect(picked).not.toBeNull();
    expect(picked?.final_status).toBe("rejected");
  });

  it("returns null with no logs", () => {
    expect(pickTargetLog([], "2026-08-01")).toBeNull();
  });
});
