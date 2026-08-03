import { describe, it, expect } from "vitest";
import { applyDeductionWaiver, type DeductionWaiver } from "./allowances";

// A waiver corrects ONE deduction line instead of replacing the whole month.
//
// The safety property that matters — and the reason a MANAGER may do this while
// the whole-month override stays OWNER/ADMIN — is that the result is clamped to
// [0, computed]. A waiver can only ever give back money the engine took. It
// cannot invent a deduction, inflate one, or turn a deduction into pay.

const line = (over: Partial<Parameters<typeof applyDeductionWaiver>[0]> = {}) => ({
  kind: "absent" as const,
  label: "No-show (scheduled, didn't clock in)",
  amount: 20,
  date: "2026-07-12",
  key: "noshow|2026-07-12",
  ...over,
});

const waivers = (entries: Record<string, DeductionWaiver>) =>
  new Map<string, DeductionWaiver>(Object.entries(entries));

describe("applyDeductionWaiver", () => {
  it("leaves an unwaived line exactly as the engine computed it", () => {
    const d = applyDeductionWaiver(line(), waivers({}));
    expect(d.amount).toBe(20);
    expect(d.originalAmount).toBe(20);
    expect(d.waived).toBe(false);
    expect(d.waivedReason).toBeNull();
  });

  it("waives a line to zero and keeps what it was, for the audit trail", () => {
    const d = applyDeductionWaiver(
      line(),
      waivers({ "noshow|2026-07-12": { amount: 0, reason: "approved leave, keyed late" } }),
    );
    expect(d.amount).toBe(0);
    expect(d.originalAmount).toBe(20);
    expect(d.waived).toBe(true);
    expect(d.waivedReason).toBe("approved leave, keyed late");
  });

  it("supports a partial reduction, not just all-or-nothing", () => {
    const d = applyDeductionWaiver(
      line({ kind: "late", label: "Late 34m", amount: 10, key: "late|log-1" }),
      waivers({ "late|log-1": { amount: 5, reason: "half — bus was cancelled" } }),
    );
    expect(d.amount).toBe(5);
    expect(d.originalAmount).toBe(10);
  });

  it("CANNOT inflate a deduction — it clamps to what the engine computed", () => {
    const d = applyDeductionWaiver(
      line(),
      waivers({ "noshow|2026-07-12": { amount: 500, reason: "typo, or worse" } }),
    );
    expect(d.amount).toBe(20);
  });

  it("CANNOT go negative — a deduction never becomes extra pay", () => {
    const d = applyDeductionWaiver(
      line(),
      waivers({ "noshow|2026-07-12": { amount: -50, reason: "nope" } }),
    );
    expect(d.amount).toBe(0);
  });

  it("falls back to charging in full when the stored amount is junk", () => {
    // A non-numeric amount must not silently zero the deduction: the safe
    // default when we cannot read the correction is to leave the charge alone.
    const d = applyDeductionWaiver(
      line(),
      waivers({ "noshow|2026-07-12": { amount: Number("abc"), reason: "corrupt row" } }),
    );
    expect(d.amount).toBe(20);
    expect(d.waived).toBe(true);
  });

  it("matches on the exact key — a waiver cannot leak onto another line", () => {
    // Two absences in the same month. Waiving the 12th must not touch the 19th.
    const twelfth = applyDeductionWaiver(line(), waivers({ "noshow|2026-07-12": { amount: 0, reason: "leave" } }));
    const nineteenth = applyDeductionWaiver(
      line({ date: "2026-07-19", key: "noshow|2026-07-19" }),
      waivers({ "noshow|2026-07-12": { amount: 0, reason: "leave" } }),
    );
    expect(twelfth.amount).toBe(0);
    expect(nineteenth.amount).toBe(20);
  });

  it("keys lateness on the LOG id, so a recompute can't move the waiver", () => {
    // Two clock-ins on one day (split shift) both late: they are separate lines
    // with separate keys. A date-based key would have collapsed them into one
    // and waived both.
    const w = waivers({ "late|log-a": { amount: 0, reason: "roster changed verbally" } });
    const first = applyDeductionWaiver(line({ kind: "late", amount: 10, key: "late|log-a" }), w);
    const second = applyDeductionWaiver(line({ kind: "late", amount: 10, key: "late|log-b" }), w);
    expect(first.amount).toBe(0);
    expect(second.amount).toBe(10);
  });

  it("rounds to sen rather than carrying float error into the payslip", () => {
    const d = applyDeductionWaiver(
      line({ amount: 20 }),
      waivers({ "noshow|2026-07-12": { amount: 0.1 + 0.2, reason: "third of nothing" } }),
    );
    expect(d.amount).toBe(0.3);
  });
});

describe("what a waived month totals", () => {
  // Zikry's Aug 2026 line from the owner's screenshot: RM67.00 earned,
  // 2 late + 1 absent = RM40.00 deducted, RM27.00 paid. Waiving the absence
  // (the one that was approved leave) should pay RM47.00 — NOT RM67.00, which
  // is what the whole-month override would have produced if someone typed the
  // earned figure to "fix" it.
  const lines = [
    { kind: "late" as const, label: "Late 22m", amount: 10, date: "2026-08-04", key: "late|log-1" },
    { kind: "late" as const, label: "Late 18m", amount: 10, date: "2026-08-11", key: "late|log-2" },
    { kind: "absent" as const, label: "No-show", amount: 20, date: "2026-08-18", key: "noshow|2026-08-18" },
  ];
  const earned = 67;

  it("charges everything with no waivers", () => {
    const total = lines.map((l) => applyDeductionWaiver(l, waivers({}))).reduce((s, d) => s + d.amount, 0);
    expect(earned - total).toBe(27);
  });

  it("gives back only the waived line", () => {
    const w = waivers({ "noshow|2026-08-18": { amount: 0, reason: "approved leave" } });
    const applied = lines.map((l) => applyDeductionWaiver(l, w));
    expect(applied.reduce((s, d) => s + d.amount, 0)).toBe(20);
    expect(earned - 20).toBe(47);
    // The two latenesses still stand — this is a correction, not an amnesty.
    expect(applied.filter((d) => d.waived)).toHaveLength(1);
  });
});
