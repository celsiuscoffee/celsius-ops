import { describe, it, expect } from "vitest";
import { summarizeOutcome } from "./loop-engine";

// summarizeOutcome feeds the campaign_outcomes verdict column — the evidence
// gates and the ±2pp noise band are what keep "win" meaning something.

const stat = (arm: string, n: number, conversionRate: number, extra: Record<string, number> = {}) => ({
  arm,
  n,
  conversion_rate: conversionRate,
  lift_pp: 0,
  revenue_per_recipient_rm: 0,
  ...extra,
});

describe("summarizeOutcome", () => {
  it("pools treatment arms and reads lift against the holdout", () => {
    const s = summarizeOutcome([
      stat("holdout", 20, 10),
      stat("flat5_min25", 30, 20), // 6 converted
      stat("b1f1_drinks", 10, 40), // 4 converted
    ]);
    // pooled treatment: 10/40 = 25%
    expect(s.resultPct).toBe(25);
    expect(s.baselinePct).toBe(10);
    expect(s.upliftPp).toBe(15);
    expect(s.verdict).toBe("win");
  });

  it("calls a loss when treatment underperforms beyond the noise band", () => {
    const s = summarizeOutcome([stat("holdout", 20, 15), stat("a", 40, 5)]);
    expect(s.verdict).toBe("loss");
  });

  it("stays neutral inside the ±2pp band", () => {
    const s = summarizeOutcome([stat("holdout", 20, 10), stat("a", 40, 11)]);
    expect(s.verdict).toBe("neutral");
  });

  it("marks thin evidence invalid (tiny holdout or tiny treatment)", () => {
    expect(summarizeOutcome([stat("holdout", 2, 0), stat("a", 40, 30)]).verdict).toBe("invalid");
    expect(summarizeOutcome([stat("holdout", 20, 0), stat("a", 5, 60)]).verdict).toBe("invalid");
    // no holdout at all (e.g. birthday runs 0% holdout)
    expect(summarizeOutcome([stat("a", 40, 30)]).verdict).toBe("invalid");
  });
});
