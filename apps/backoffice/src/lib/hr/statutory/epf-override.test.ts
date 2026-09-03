import { describe, it, expect } from "vitest";
import { epfContribution, resolveEpfEmployerOverride } from "./formulas";

// hr_employee_profiles.epf_employer_rate had DEFAULT 12, so all 81 profiles
// carried 12.00 and the calculator honoured it as an override — 12% employer
// EPF on every wage, where KWSP's Third Schedule says 13% up to RM5,000.
// Shairuleen (RM2,200): paid 264, due 286. July 2026 was confirmed that way.
describe("resolveEpfEmployerOverride — the column default is not a decision", () => {
  const sched = { scheduleBelow5000: 13, scheduleAbove5000: 12 };

  it("12 on a ≤ RM5,000 wage is the legacy default → schedule applies (13%)", () => {
    expect(resolveEpfEmployerOverride({ profileRate: 12, wage: 2200, ...sched })).toBeUndefined();
    const c = epfContribution({
      wage: 2200, employeeRate: 11, employerRateBelow5000: 13, employerRateAbove5000: 12,
      employerRateOverride: resolveEpfEmployerOverride({ profileRate: 12, wage: 2200, ...sched }),
    });
    expect(c.employer).toBe(286);
    expect(c.employee).toBe(242);
  });

  it("12 on a > RM5,000 wage is what the schedule pays anyway → honoured", () => {
    expect(resolveEpfEmployerOverride({ profileRate: 12, wage: 10500, ...sched })).toBe(12);
  });

  it("a genuine override (any other value) is honoured", () => {
    expect(resolveEpfEmployerOverride({ profileRate: 15, wage: 2200, ...sched })).toBe(15);
    expect(resolveEpfEmployerOverride({ profileRate: 4, wage: 2200, ...sched })).toBe(4);
  });

  it("null / empty / zero mean 'use the schedule'", () => {
    expect(resolveEpfEmployerOverride({ profileRate: null, wage: 2200, ...sched })).toBeUndefined();
    expect(resolveEpfEmployerOverride({ profileRate: undefined, wage: 2200, ...sched })).toBeUndefined();
    expect(resolveEpfEmployerOverride({ profileRate: 0, wage: 2200, ...sched })).toBeUndefined();
  });
});
