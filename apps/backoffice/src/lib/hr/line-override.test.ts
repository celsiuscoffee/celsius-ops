import { describe, it, expect } from "vitest";
import { applyLineOverride, type LineOverride } from "./allowances";

// Every line of the performance allowance is editable by hand — a lever the
// engine couldn't score fairly, a deduction that shouldn't stand. There is no
// whole-month replace any more.
//
// The property that matters, and the reason this is delegable to a manager, is
// the clamp: the result lands in [0, max]. `max` is the computed charge for a
// deduction (so an edit can only give back money the engine took) and the pool
// for a lever (so no single edit inflates a month past the allowance).

const overrides = (entries: Record<string, LineOverride>) =>
  new Map<string, LineOverride>(Object.entries(entries));

const POOL = 200;

describe("levers — clamped to the pool", () => {
  const lever = (over: Partial<{ key: string; amount: number }> = {}) => ({
    key: "lever|checklist", amount: 80, ...over,
  });

  it("leaves an unedited lever exactly as scored", () => {
    const l = applyLineOverride(lever(), overrides({}), POOL);
    expect(l.amount).toBe(80);
    expect(l.originalAmount).toBe(80);
    expect(l.edited).toBe(false);
    expect(l.editReason).toBeNull();
  });

  it("pays a hand-set figure and keeps what the engine scored", () => {
    const l = applyLineOverride(
      lever(),
      overrides({ "lever|checklist": { amount: 40, reason: "only 2 checklists were assigned all month" } }),
      POOL,
    );
    expect(l.amount).toBe(40);
    expect(l.originalAmount).toBe(80);
    expect(l.edited).toBe(true);
    expect(l.editReason).toBe("only 2 checklists were assigned all month");
  });

  it("can pay a lever the engine scored at zero — the case this exists for", () => {
    // Serving time dragged to nothing by one broken shift, or a lever with no
    // data at all. Its slice is 0, so clamping to the slice would make the
    // correction impossible.
    const l = applyLineOverride(
      { key: "lever|serving", amount: 0 },
      overrides({ "lever|serving": { amount: 40, reason: "POS clock was wrong on 12 Jul, avg is not real" } }),
      POOL,
    );
    expect(l.amount).toBe(40);
  });

  it("CANNOT exceed the pool, so one lever can't inflate a month", () => {
    const l = applyLineOverride(
      lever(),
      overrides({ "lever|checklist": { amount: 5_000, reason: "fat finger" } }),
      POOL,
    );
    expect(l.amount).toBe(POOL);
  });

  it("CANNOT go negative", () => {
    const l = applyLineOverride(lever(), overrides({ "lever|checklist": { amount: -50, reason: "no" } }), POOL);
    expect(l.amount).toBe(0);
  });

  it("edits one lever without touching the others", () => {
    const o = overrides({ "lever|checklist": { amount: 0, reason: "not assigned" } });
    expect(applyLineOverride({ key: "lever|checklist", amount: 80 }, o, POOL).amount).toBe(0);
    expect(applyLineOverride({ key: "lever|phone", amount: 40 }, o, POOL).amount).toBe(40);
  });
});

describe("deductions — clamped to what the engine charged", () => {
  const noshow = { key: "noshow|2026-07-12", amount: 20 };

  it("waives a line to zero and keeps what it was, for the audit trail", () => {
    const d = applyLineOverride(
      noshow,
      overrides({ "noshow|2026-07-12": { amount: 0, reason: "approved leave, keyed late" } }),
      noshow.amount,
    );
    expect(d.amount).toBe(0);
    expect(d.originalAmount).toBe(20);
    expect(d.edited).toBe(true);
  });

  it("supports a partial reduction, not just all-or-nothing", () => {
    const late = { key: "late|log-1", amount: 10 };
    const d = applyLineOverride(late, overrides({ "late|log-1": { amount: 5, reason: "half — bus cancelled" } }), late.amount);
    expect(d.amount).toBe(5);
  });

  it("CANNOT inflate a deduction — max is what the engine charged", () => {
    const d = applyLineOverride(noshow, overrides({ "noshow|2026-07-12": { amount: 500, reason: "typo" } }), noshow.amount);
    expect(d.amount).toBe(20);
  });

  it("keys lateness on the LOG id, so a recompute can't move the edit", () => {
    // Two clock-ins on one day (split shift) both late: separate lines, separate
    // keys. A date-based key would have collapsed and waived both.
    const o = overrides({ "late|log-a": { amount: 0, reason: "roster changed verbally" } });
    expect(applyLineOverride({ key: "late|log-a", amount: 10 }, o, 10).amount).toBe(0);
    expect(applyLineOverride({ key: "late|log-b", amount: 10 }, o, 10).amount).toBe(10);
  });
});

describe("bad stored data", () => {
  it("falls back to the computed figure when the amount is junk", () => {
    // Must not silently zero a deduction or a lever: when we can't read the
    // correction, leaving the engine's figure alone is the safe failure.
    const d = applyLineOverride(
      { key: "noshow|2026-07-12", amount: 20 },
      overrides({ "noshow|2026-07-12": { amount: Number("abc"), reason: "corrupt row" } }),
      20,
    );
    expect(d.amount).toBe(20);
    expect(d.edited).toBe(true);
  });

  it("rounds to sen rather than carrying float error into a payslip", () => {
    const l = applyLineOverride(
      { key: "lever|audit", amount: 40 },
      overrides({ "lever|audit": { amount: 0.1 + 0.2, reason: "token amount" } }),
      POOL,
    );
    expect(l.amount).toBe(0.3);
  });
});

describe("what an edited month totals", () => {
  // Zikry's Aug line from the owner's screenshot: RM67.00 earned across levers,
  // 2 late + 1 absent = RM40.00 deducted, RM27.00 paid.
  const levers = [
    { key: "lever|checklist", amount: 27 },
    { key: "lever|serving", amount: 40 },
  ];
  const deductions = [
    { key: "late|log-1", amount: 10 },
    { key: "late|log-2", amount: 10 },
    { key: "noshow|2026-08-18", amount: 20 },
  ];

  const total = (o: Map<string, LineOverride>) =>
    levers.reduce((s, l) => s + applyLineOverride(l, o, POOL).amount, 0) -
    deductions.reduce((s, d) => s + applyLineOverride(d, o, d.amount).amount, 0);

  it("pays RM27.00 with nothing edited", () => {
    expect(total(overrides({}))).toBe(27);
  });

  it("waiving the wrong absence pays RM47.00 — not the RM67.00 a whole-month replace would have", () => {
    expect(total(overrides({ "noshow|2026-08-18": { amount: 0, reason: "approved leave" } }))).toBe(47);
  });

  it("fixing an unscoreable lever leaves the real deductions standing", () => {
    // Checklist set to its full RM80 because none were assigned; the two
    // latenesses still cost RM20. This is a correction, not an amnesty.
    expect(total(overrides({ "lever|checklist": { amount: 80, reason: "no checklists assigned" } }))).toBe(80);
  });
});
