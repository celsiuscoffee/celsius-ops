import { describe, it, expect } from "vitest";
import { paymentModel } from "./payment-model";

describe("paymentModel", () => {
  it("classifies a deposit policy as deposit + balance (two POPs, critical)", () => {
    const m = paymentModel({ depositPercent: 50, paymentTerms: null });
    expect(m.model).toBe("deposit_balance");
    expect(m.popDeliveryCritical).toBe(true);
    expect(m.label).toContain("50%");
  });

  it("treats a full 100% deposit as not a deposit-balance split", () => {
    // 100 isn't a partial deposit; fall through to terms parsing.
    expect(paymentModel({ depositPercent: 100, paymentTerms: "" }).model).toBe("standard");
  });

  it("detects prepay terms as delivery-critical", () => {
    for (const t of ["Prepay before delivery", "clear payment first", "Cash before delivery", "COD", "pay in advance", "100% upfront", "upfront"]) {
      const m = paymentModel({ paymentTerms: t });
      expect(m.model, t).toBe("prepay");
      expect(m.popDeliveryCritical, t).toBe(true);
    }
  });

  it("detects credit / SOA terms as not delivery-critical", () => {
    for (const t of ["Net 30", "14 days", "monthly credit", "settle by SOA", "30 day credit"]) {
      const m = paymentModel({ paymentTerms: t });
      expect(m.model, t).toBe("credit_soa");
      expect(m.popDeliveryCritical, t).toBe(false);
    }
  });

  it("defaults to standard when terms are unknown or empty", () => {
    expect(paymentModel({ paymentTerms: null }).model).toBe("standard");
    expect(paymentModel({ paymentTerms: "by arrangement" }).model).toBe("standard");
  });

  it("deposit policy wins over credit-looking terms", () => {
    expect(paymentModel({ depositPercent: 30, paymentTerms: "Net 30" }).model).toBe("deposit_balance");
  });
});
