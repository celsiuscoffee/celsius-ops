import { describe, it, expect } from "vitest";
import { decideRateChange, profileColumnFor, isPtRateType } from "./pt-rate-change";
import { PT_RATE_SELF_APPROVE_MAX } from "./constants";

const PT = { user_id: "pt-1", employment_type: "part_time" };
const FT = { user_id: "ft-1", employment_type: "full_time" };

// Ariff: MANAGER whose subtree covers every active part-timer.
const ariff = { role: "MANAGER", visibleUserIds: ["pt-1", "ft-1"] };
const owner = { role: "OWNER", visibleUserIds: null };

describe("decideRateChange — manager limit", () => {
  it("applies a PT rate at or below the RM11 limit immediately", () => {
    for (const amount of [9, 10, 10.5, PT_RATE_SELF_APPROVE_MAX]) {
      const d = decideRateChange(ariff, PT, "hourly", amount);
      expect(d).toMatchObject({ allowed: true, status: "approved" });
    }
  });

  it("holds anything above RM11 for approval", () => {
    const d = decideRateChange(ariff, PT, "hourly", 11.01);
    expect(d).toMatchObject({ allowed: true, status: "pending" });
    if (d.allowed) expect(d.reason).toContain("owner approval");
  });

  it("applies the same limit to the weekend rate", () => {
    expect(decideRateChange(ariff, PT, "hourly_weekend", 10)).toMatchObject({ status: "approved" });
    expect(decideRateChange(ariff, PT, "hourly_weekend", 12)).toMatchObject({ status: "pending" });
  });

  it("is a strict >, so exactly RM11.00 is still self-approved", () => {
    expect(decideRateChange(ariff, PT, "hourly", 11)).toMatchObject({ status: "approved" });
  });
});

describe("decideRateChange — what a manager may NOT touch", () => {
  it("refuses monthly salary", () => {
    expect(decideRateChange(ariff, PT, "monthly", 2000)).toMatchObject({ allowed: false });
  });

  it("refuses a full-timer even on an hourly type", () => {
    expect(decideRateChange(ariff, FT, "hourly", 9)).toMatchObject({ allowed: false });
  });

  it("refuses someone outside the manager's subtree", () => {
    const outside = { role: "MANAGER", visibleUserIds: ["someone-else"] };
    expect(decideRateChange(outside, PT, "hourly", 9)).toMatchObject({ allowed: false });
  });

  it("refuses roles below MANAGER", () => {
    expect(decideRateChange({ role: "STAFF", visibleUserIds: [] }, PT, "hourly", 9))
      .toMatchObject({ allowed: false });
  });

  it("refuses a negative or non-numeric amount", () => {
    expect(decideRateChange(ariff, PT, "hourly", -1)).toMatchObject({ allowed: false });
    expect(decideRateChange(ariff, PT, "hourly", NaN)).toMatchObject({ allowed: false });
  });
});

describe("decideRateChange — OWNER/ADMIN", () => {
  it("self-approves at any amount, PT or FT, hourly or monthly", () => {
    expect(decideRateChange(owner, PT, "hourly", 99)).toMatchObject({ allowed: true, status: "approved" });
    expect(decideRateChange(owner, FT, "monthly", 12000)).toMatchObject({ allowed: true, status: "approved" });
  });

  it("still rejects a negative amount", () => {
    expect(decideRateChange(owner, PT, "hourly", -5)).toMatchObject({ allowed: false });
  });
});

describe("helpers", () => {
  it("maps rate types to the profile column payroll reads", () => {
    expect(profileColumnFor("hourly")).toBe("hourly_rate");
    expect(profileColumnFor("hourly_weekend")).toBe("hourly_rate_weekend");
  });

  it("recognises only the two PT rate types", () => {
    expect(isPtRateType("hourly")).toBe(true);
    expect(isPtRateType("hourly_weekend")).toBe(true);
    expect(isPtRateType("monthly")).toBe(false);
    expect(isPtRateType("daily")).toBe(false);
  });
});
