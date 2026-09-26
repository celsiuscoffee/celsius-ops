import { describe, it, expect } from "vitest";
import { planSalaryAccruals, type ControlLine } from "./salary-accrual";

const OPTS = { today: "2026-09-26", cutoverMonth: "2026-07" };
const line = (o: Partial<ControlLine> & { account_code: string }): ControlLine => ({
  debit: 0,
  credit: 0,
  company_id: "co",
  txn_date: "2026-08-15",
  agent_version: "bank-bridge-v3",
  ...o,
});
const own = (o: Partial<ControlLine> & { account_code: string }) =>
  line({ agent_version: "salary-accrual-v1", txn_date: "2026-08-31", ...o });

describe("planSalaryAccruals", () => {
  it("tops up the positive debit excess, Dr expense / Cr control", () => {
    const plans = planSalaryAccruals([line({ account_code: "3008", debit: 1000 })], OPTS);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ month: "2026-08", txnDate: "2026-08-31", amount: 1000, correction: false });
    expect(plans[0].lines).toEqual([
      { accountCode: "6500-02", debit: 1000 },
      { accountCode: "3008", credit: 1000 },
    ]);
  });

  it("is a no-op once its own accrual covers the delta", () => {
    const plans = planSalaryAccruals(
      [line({ account_code: "3008", debit: 1000 }), own({ account_code: "3008", credit: 1000 })],
      OPTS,
    );
    expect(plans).toEqual([]);
  });

  it("reverses an over-accrual when the payment it covered was reversed", () => {
    const plans = planSalaryAccruals(
      [
        line({ account_code: "3008", debit: 1000 }),
        own({ account_code: "3008", credit: 1000 }),
        // bank-bridge reversal of the payment: credit back on the control
        line({ account_code: "3008", credit: 1000, agent_version: "bank-bridge-v3" }),
      ],
      OPTS,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ amount: -1000, correction: true });
    expect(plans[0].lines).toEqual([
      { accountCode: "6500-02", credit: 1000 },
      { accountCode: "3008", debit: 1000 },
    ]);
  });

  it("unwinds only the excess when HR posts a real accrual for a month already filled cash-basis", () => {
    const plans = planSalaryAccruals(
      [
        line({ account_code: "3004", debit: 500 }),
        own({ account_code: "3004", credit: 500 }),
        line({ account_code: "3004", credit: 300, agent_version: "hr-payroll-v1" }),
      ],
      OPTS,
    );
    expect(plans[0].byControl).toEqual({ "3004": -300 });
    expect(plans[0].lines).toEqual([
      { accountCode: "6501-01", credit: 300 },
      { accountCode: "3004", debit: 300 },
    ]);
  });

  it("does not treat a real HR accrual with no payment yet as an over-accrual", () => {
    // Credit-only month from HR: required = 0, own = 0 → nothing to post.
    const plans = planSalaryAccruals([line({ account_code: "3008", credit: 4000, agent_version: "hr-payroll-v1" })], OPTS);
    expect(plans).toEqual([]);
  });

  it("nets its own earlier corrections when re-deriving what it has posted", () => {
    const plans = planSalaryAccruals(
      [
        line({ account_code: "3008", debit: 800 }),
        own({ account_code: "3008", credit: 1000 }),
        own({ account_code: "3008", debit: 200 }), // previous correction
      ],
      OPTS,
    );
    expect(plans).toEqual([]);
  });

  it("merges 3008 and 3007 onto one 6500-02 line, balanced", () => {
    const plans = planSalaryAccruals(
      [line({ account_code: "3008", debit: 700 }), line({ account_code: "3007", debit: 300 })],
      OPTS,
    );
    const dr = plans[0].lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const cr = plans[0].lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(dr).toBe(cr);
    expect(plans[0].lines.filter((l) => l.accountCode === "6500-02")).toEqual([{ accountCode: "6500-02", debit: 1000 }]);
  });

  it("skips pre-cutover and future months and dates the current month today", () => {
    const plans = planSalaryAccruals(
      [
        line({ account_code: "3008", debit: 100, txn_date: "2026-06-10" }),
        line({ account_code: "3008", debit: 100, txn_date: "2026-10-01" }),
        line({ account_code: "3008", debit: 100, txn_date: "2026-09-02" }),
      ],
      OPTS,
    );
    expect(plans.map((p) => [p.month, p.txnDate])).toEqual([["2026-09", "2026-09-26"]]);
  });
});
