import { describe, it, expect } from "vitest";
import { holdoutBucket, isHoldoutMember } from "./loop-engine";

// Guards the attribution-critical invariant: a member is a STABLE control for a
// loop. A per-round random split (the old behaviour) let a member be treated in
// one round and held out in another, filling the "control" with already-SMSed
// members so lift read false. These tests lock that down.
describe("deterministic holdout", () => {
  const members = Array.from({ length: 5000 }, (_, i) => `m-${i}`);

  it("is stable: same (loop, member, pct) always yields the same side", () => {
    for (const m of members.slice(0, 200)) {
      const first = isHoldoutMember("winback", m, 10);
      for (let r = 0; r < 5; r++) expect(isHoldoutMember("winback", m, 10)).toBe(first);
    }
  });

  it("never treats a member who is also held out for the same loop (no contamination)", () => {
    // Two independent "rounds" over overlapping pools must not disagree on a member.
    const roundA = members.filter((m) => !isHoldoutMember("winback", m, 10));
    const roundBHoldout = new Set(members.filter((m) => isHoldoutMember("winback", m, 10)));
    expect(roundA.some((m) => roundBHoldout.has(m))).toBe(false);
  });

  it("is monotonic in pct: holdout at a lower pct is a subset of a higher pct", () => {
    const at10 = new Set(members.filter((m) => isHoldoutMember("winback", m, 10)));
    const at20 = new Set(members.filter((m) => isHoldoutMember("winback", m, 20)));
    for (const m of at10) expect(at20.has(m)).toBe(true);
  });

  it("realizes roughly the requested holdout fraction at scale", () => {
    const held = members.filter((m) => isHoldoutMember("winback", m, 10)).length;
    const frac = held / members.length;
    expect(frac).toBeGreaterThan(0.07);
    expect(frac).toBeLessThan(0.13);
  });

  it("holdoutPct=0 holds out nobody (birthday-style always-on loop)", () => {
    expect(members.every((m) => !isHoldoutMember("birthday", m, 0))).toBe(true);
  });

  it("partitions differently per loop (a member's side is loop-specific)", () => {
    // Different loops should not assign identical sides to every member.
    const diff = members.filter(
      (m) => isHoldoutMember("winback", m, 20) !== isHoldoutMember("welcome", m, 20),
    );
    expect(diff.length).toBeGreaterThan(0);
  });

  it("bucket is in range [0,100)", () => {
    for (const m of members.slice(0, 500)) {
      const b = holdoutBucket("winback", m);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });
});
