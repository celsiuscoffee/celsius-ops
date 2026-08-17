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
  it("managers can never retro-edit a published week", () => {
    const r = retroEditRefusal("MANAGER", "typo fix");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.status).toBe(403);
  });

  it("owner/admin without a reason is refused with the how-to", () => {
    for (const role of ["OWNER", "ADMIN"]) {
      const r = retroEditRefusal(role, "");
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.status).toBe(409);
    }
    const blank = retroEditRefusal("OWNER", "   ");
    expect(blank.allowed).toBe(false);
  });

  it("owner/admin with an explicit reason proceeds", () => {
    expect(retroEditRefusal("OWNER", "wrong template published for 12 Aug")).toEqual({ allowed: true });
    expect(retroEditRefusal("ADMIN", "swap recorded on paper, backfilling")).toEqual({ allowed: true });
  });
});
