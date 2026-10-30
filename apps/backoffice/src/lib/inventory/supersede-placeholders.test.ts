import { describe, it, expect } from "vitest";
import { amountsMatch, pickPlaceholderMatch } from "./supersede-placeholders";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("amountsMatch", () => {
  it("allows rounding and small fees, within max(RM2, 0.5%)", () => {
    expect(amountsMatch(1764.5, 1765.29)).toBe(true); // Yow Seng GRNI-CC001-3272 vs YSIV2609-PUTRAJAYA
    expect(amountsMatch(100, 101.9)).toBe(true);
    expect(amountsMatch(100, 103)).toBe(false);
  });
});

describe("pickPlaceholderMatch", () => {
  it("retires the single placeholder a bill matches, nearest in date", () => {
    const ids = pickPlaceholderMatch(
      [
        { id: "far", amount: 490, issueDate: d("2026-08-01") },
        { id: "near", amount: 490, issueDate: d("2026-08-24") },
      ],
      490,
      d("2026-08-22"),
    );
    expect(ids).toEqual(["near"]);
  });

  it("retires several placeholders billed together on one invoice", () => {
    // Global Coffee Resources: GRNI-3271 RM747.06 + GRNI-3406 RM1,777.99 vs one RM2,529.82 bill.
    const ids = pickPlaceholderMatch(
      [
        { id: "3271", amount: 747.06, issueDate: d("2026-09-01") },
        { id: "3406", amount: 1777.99, issueDate: d("2026-09-14") },
        { id: "other", amount: 412.0, issueDate: d("2026-09-10") },
      ],
      2529.82,
      d("2026-09-03"),
    );
    expect(ids.sort()).toEqual(["3271", "3406"]);
  });

  it("leaves placeholders alone when no amount or combination fits", () => {
    expect(
      pickPlaceholderMatch([{ id: "a", amount: 300, issueDate: d("2026-09-01") }], 1000, d("2026-09-02")),
    ).toEqual([]);
  });

  it("refuses to guess when two different sets add up to the bill", () => {
    const ids = pickPlaceholderMatch(
      [
        { id: "a", amount: 100, issueDate: d("2026-09-01") },
        { id: "b", amount: 200, issueDate: d("2026-09-02") },
        { id: "c", amount: 150, issueDate: d("2026-09-03") },
        { id: "e", amount: 150, issueDate: d("2026-09-04") },
      ],
      300,
      d("2026-09-02"),
    );
    expect(ids).toEqual([]);
  });
});
