import { describe, it, expect } from "vitest";
import { pickGrantArm, type GrantArm } from "../grant-loop";

const arms: GrantArm[] = [
  { key: "free_coffee", label: "Free Coffee", voucher_template_id: "t-coffee" },
  { key: "b1f1", label: "Buy 1 Free 1", voucher_template_id: "t-b1f1" },
];

describe("pickGrantArm", () => {
  it("assigns control below the control share and arms above it", () => {
    expect(pickGrantArm(50, arms, 0)).toBe("control");
    expect(pickGrantArm(50, arms, 0.4999)).toBe("control");
    expect(pickGrantArm(50, arms, 0.5)).toEqual(arms[0]);
    expect(pickGrantArm(50, arms, 0.74)).toEqual(arms[0]);
    expect(pickGrantArm(50, arms, 0.75)).toEqual(arms[1]);
    expect(pickGrantArm(50, arms, 0.9999)).toEqual(arms[1]);
  });

  it("splits the treatment share uniformly across arms", () => {
    // controlPct 40 → arms occupy [0.4, 1.0), boundary near 0.7 (exact edge is
    // FP-dependent, so probe either side of it)
    expect(pickGrantArm(40, arms, 0.69)).toEqual(arms[0]);
    expect(pickGrantArm(40, arms, 0.71)).toEqual(arms[1]);
  });

  it("always returns control when there are no arms", () => {
    expect(pickGrantArm(50, [], 0.99)).toBe("control");
    expect(pickGrantArm(0, [], 0.5)).toBe("control");
  });

  it("controlPct 0 never assigns control; 100 always does", () => {
    expect(pickGrantArm(0, arms, 0)).toEqual(arms[0]);
    expect(pickGrantArm(0, arms, 0.999)).toEqual(arms[1]);
    expect(pickGrantArm(100, arms, 0.999)).toBe("control");
  });

  it("clamps out-of-range controlPct instead of misassigning", () => {
    expect(pickGrantArm(-10, arms, 0.001)).toEqual(arms[0]);
    expect(pickGrantArm(150, arms, 0.999)).toBe("control");
  });

  it("never returns an out-of-bounds arm at the top edge", () => {
    // rand asymptotically close to 1 must clamp to the last arm
    expect(pickGrantArm(50, arms, 0.9999999999)).toEqual(arms[1]);
  });
});
