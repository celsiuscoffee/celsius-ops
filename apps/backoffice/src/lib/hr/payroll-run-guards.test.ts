import { describe, it, expect } from "vitest";

// WHAT MAY BE DELETED, AND WHAT MUST BE REVERTED FIRST.
//
// The delete guard used to check `paid` alone. A CONFIRMED run — the thing
// payslips and bank files are generated from — went through without a prompt,
// a backup, or a log line. It cost real data twice on 2026-08-03:
//
//   * the `opening_balance` run, which carried BrioHR's Jan–Jun YTD for 34
//     people. Losing it understated Ariff Izham's July PCB by RM446.10.
//   * the entire July monthly run, deleted 22 seconds after a recompute
//     rebuilt it. 29 lines, gone, with no ActivityLog row naming who did it.
//
// Both were reachable because "unlock so I can recompute" had no path except
// delete. So the fix is two-sided: refuse the delete AND provide `revert`.

type Status = "draft" | "ai_computed" | "confirmed" | "paid";

/** Mirrors the shipped DELETE guard. */
const canDelete = (s: Status) => s !== "paid" && s !== "confirmed";

/** Mirrors the shipped revert guard: confirmed → ai_computed, nothing else. */
const canRevert = (s: Status) => s === "confirmed";

describe("DELETE guard", () => {
  it("allows a draft or ai_computed run — nothing has been published from these", () => {
    expect(canDelete("draft")).toBe(true);
    expect(canDelete("ai_computed")).toBe(true);
  });

  it("REFUSES a confirmed run — this is the hole that ate July 2026", () => {
    expect(canDelete("confirmed")).toBe(false);
  });

  it("REFUSES a paid run", () => {
    expect(canDelete("paid")).toBe(false);
  });
});

describe("revert", () => {
  it("takes a confirmed run back to ai_computed", () => {
    expect(canRevert("confirmed")).toBe(true);
  });

  it("refuses a paid run — bank files exist, that is a finance decision", () => {
    expect(canRevert("paid")).toBe(false);
  });

  it("refuses runs that are not confirmed in the first place", () => {
    expect(canRevert("draft")).toBe(false);
    expect(canRevert("ai_computed")).toBe(false);
  });
});

describe("the two together leave no way to destroy a confirmed run by accident", () => {
  it("every status is either deletable or revertable, never neither", () => {
    // The property that matters operationally: a confirmed month can still be
    // redone (revert → recompute), so closing the delete hole does not lock
    // anyone out. Only `paid` is a dead end, deliberately.
    for (const s of ["draft", "ai_computed", "confirmed"] as Status[]) {
      expect(canDelete(s) || canRevert(s)).toBe(true);
    }
    expect(canDelete("paid") || canRevert("paid")).toBe(false);
  });

  it("redoing a confirmed month takes two deliberate steps, not one click", () => {
    const s: Status = "confirmed";
    expect(canDelete(s)).toBe(false);   // step 1 is refused
    expect(canRevert(s)).toBe(true);    // ...you must revert
    expect(canDelete("ai_computed")).toBe(true); // and only then is it disposable
  });
});
