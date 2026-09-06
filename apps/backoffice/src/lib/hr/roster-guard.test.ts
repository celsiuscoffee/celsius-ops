import { describe, it, expect } from "vitest";
import { classifyRosterEdit, retroEditRefusal } from "./roster-guard";

// A published roster is the pay basis (weekly PT windows, monthly rest days).
// Retroactive edits to it rewrote already-worked pay with no guard and no
// trail — the 2026-08-03 vanishing-pay incident class. These pin the policy.

const TODAY = "2026-08-15";

describe("classifyRosterEdit", () => {
  it("draft weeks are free to edit regardless of date", () => {
    expect(classifyRosterEdit("draft", "2026-08-01", TODAY)).toBe("draft");
    expect(classifyRosterEdit(null, "2026-08-01", TODAY)).toBe("draft");
    expect(classifyRosterEdit(undefined, "2026-08-20", TODAY)).toBe("draft");
  });

  it("published + future date is allowed", () => {
    expect(classifyRosterEdit("published", "2026-08-16", TODAY)).toBe("published_future");
  });

  it("published + today is allowed (same-day coverage moves)", () => {
    expect(classifyRosterEdit("published", TODAY, TODAY)).toBe("published_today");
  });

  it("published + past date is the locked class", () => {
    expect(classifyRosterEdit("published", "2026-08-14", TODAY)).toBe("published_past");
  });
});

describe("retroEditRefusal", () => {
  it("without the retro-edit capability it is refused outright", () => {
    const r = retroEditRefusal(false, "typo fix");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.status).toBe(403);
  });

  it("holding the capability without a reason is refused with the how-to", () => {
    const r = retroEditRefusal(true, "");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.status).toBe(409);
    const blank = retroEditRefusal(true, "   ");
    expect(blank.allowed).toBe(false);
    if (!blank.allowed) expect(blank.status).toBe(409);
  });

  it("holding the capability with an explicit reason proceeds", () => {
    expect(retroEditRefusal(true, "wrong template published for 12 Aug")).toEqual({ allowed: true });
  });

  it("a reason alone never substitutes for the capability", () => {
    expect(retroEditRefusal(false, "swap recorded on paper, backfilling").allowed).toBe(false);
  });
});
