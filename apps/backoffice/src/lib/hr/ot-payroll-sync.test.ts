import { describe, it, expect } from "vitest";
import { decideRealLogPatch } from "./ot-payroll-sync";

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
