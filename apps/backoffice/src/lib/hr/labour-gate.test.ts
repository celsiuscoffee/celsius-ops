import { describe, it, expect } from "vitest";
import {
  costRoster,
  shiftHours,
  verdictFor,
  OUTLET_BUDGETS,
  ROVER_SHARE_WEEKLY,
  borrowedFtCharge,
  lentFtCredit,
  type ShiftCostRow,
} from "./labour-gate-lib";

const base = {
  shift_date: "2026-07-06",
  start_time: "08:00:00",
  end_time: "16:00:00", // 8h
};

function ft(name: string, salary: number, overrides: Partial<ShiftCostRow> = {}): ShiftCostRow {
  return {
    ...base,
    user_id: name,
    userName: name,
    position: "Barista",
    employment_type: "full_time",
    hourly_rate: null,
    basic_salary: salary,
    epf_employer_rate: null,
    ...overrides,
  };
}

function pt(name: string, rate: number, overrides: Partial<ShiftCostRow> = {}): ShiftCostRow {
  return {
    ...base,
    user_id: name,
    userName: name,
    position: "Barista",
    employment_type: "part_time",
    hourly_rate: rate,
    basic_salary: null,
    epf_employer_rate: null,
    ...overrides,
  };
}

describe("shiftHours", () => {
  it("computes plain and overnight spans", () => {
    expect(shiftHours("08:00:00", "16:00:00")).toBe(8);
    expect(shiftHours("15:00:00", "23:00:00")).toBe(8);
    expect(shiftHours("22:00:00", "02:00:00")).toBe(4); // overnight wraps
  });
});

describe("costRoster", () => {
  it("prices FT via salary/26/7.5 plus employer statutory", () => {
    const { cost, hours, blockers } = costRoster([ft("A", 1950)]);
    // 1950/26/7.5 = RM10/h × 8h = RM80 gross; + statutory 14.95% ≈ RM91.96
    expect(hours).toBe(8);
    expect(blockers).toEqual([]);
    expect(cost).toBeCloseTo(80 * 1.1495, 1);
  });

  it("prices PT at raw hourly rate (statutory paid outside outlet PT account)", () => {
    const { cost } = costRoster([pt("B", 9)]);
    expect(cost).toBe(72);
  });

  it("blocks on missing profile or missing rate instead of undercounting", () => {
    const noProfile = { ...pt("C", 9), employment_type: null };
    const noRate = pt("D", 0);
    const noSalary = ft("E", 0);
    const { cost, blockers } = costRoster([noProfile, noRate, noSalary]);
    expect(cost).toBe(0);
    expect(blockers).toHaveLength(3);
  });

  it("costs rovers at RM0 but flags quota breaches", () => {
    const rover = (i: number) =>
      ({ ...ft("Adam", 3900), user_id: "adam", userName: "Adam", position: "Manager", shift_date: `2026-07-0${6 + i}` }) as ShiftCostRow;
    const { cost, warnings } = costRoster([rover(0), rover(1), rover(2)]);
    expect(cost).toBe(0); // AM sits in HQ overhead, not the outlet
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("rover quota");
  });

  it("stays quiet when the rover is within quota", () => {
    const { warnings } = costRoster([
      { ...ft("Syafiq", 3500), position: "Barista Lead" },
    ]);
    expect(warnings).toEqual([]);
  });
});

describe("verdictFor", () => {
  const budget = OUTLET_BUDGETS.CC002; // Shah Alam 18/20
  it("maps pct to green/amber/red and unknown when no forecast", () => {
    expect(verdictFor(0.17, budget)).toBe("green");
    expect(verdictFor(0.19, budget)).toBe("amber");
    expect(verdictFor(0.21, budget)).toBe("red");
    expect(verdictFor(null, budget)).toBe("unknown");
  });
});

describe("rover share constant", () => {
  it("is ⅓ of the workbook's RM4,022/mo rover cost, weekly", () => {
    expect(ROVER_SHARE_WEEKLY).toBe(Math.round(((4022 / 3) * 12) / 52));
  });
});

describe("rotation cost split (cost follows hours)", () => {
  const share = 520; // e.g. RM1,900 basic + statutory ≈ RM520/wk

  it("borrowing outlet pays pro-rata for the hours worked there", () => {
    expect(borrowedFtCharge(share, 45)).toBeCloseTo(share, 5); // full week borrowed → full share
    expect(borrowedFtCharge(share, 22.5)).toBeCloseTo(share / 2, 5); // 3 of 6 days
    expect(borrowedFtCharge(share, 0)).toBe(0);
  });

  it("home outlet is credited the same slice — never more than the share", () => {
    expect(lentFtCredit(share, 45)).toBeCloseTo(share, 5); // fully lent → home pays 0
    expect(lentFtCredit(share, 22.5)).toBeCloseTo(share / 2, 5);
    expect(lentFtCredit(share, 90)).toBeCloseTo(share, 5); // data glitch clamps at 100%
    expect(lentFtCredit(share, -5)).toBe(0);
  });

  it("charge + home remainder always equals exactly one share (no double count)", () => {
    for (const h of [0, 7.5, 15, 22.5, 30, 45]) {
      expect(borrowedFtCharge(share, h) + (share - lentFtCredit(share, h))).toBeCloseTo(share, 5);
    }
  });
});
