import { describe, it, expect } from "vitest";
import { classifyPopLeg } from "./pop-leg";

// The real shape this was written for: Collective Project, 10% deposit terms.
// Face values and the 90% legs are taken from the live invoices reconciled on
// 2026-09-17 (IV-01974 etc. at RM2,815, IV-02036 at RM1,893, IV-02003 at RM1,885).
const collective = (invoiceAmount: number, status: string, amountPaid: number) => ({
  invoiceAmount,
  depositAmount: Number((invoiceAmount * 0.1).toFixed(2)),
  amountPaid,
  status,
});

describe("classifyPopLeg", () => {
  it("matches the full amount on an untouched invoice", () => {
    expect(
      classifyPopLeg({ popAmount: 2815, ...collective(2815, "PENDING", 0) }),
    ).toBe("full");
  });

  it("matches the deposit leg on an untouched deposit-terms invoice", () => {
    expect(
      classifyPopLeg({ popAmount: 281.5, ...collective(2815, "PENDING", 0) }),
    ).toBe("deposit");
  });

  it("matches the 90% balance leg once the deposit is paid — the defect this fixes", () => {
    // RM2,533.50 is exactly 90% of RM2,815. Before the fix this returned nothing
    // and the payment dead-ended; 18 real payments of this shape went unmatched.
    expect(
      classifyPopLeg({ popAmount: 2533.5, ...collective(2815, "DEPOSIT_PAID", 281.5) }),
    ).toBe("balance");
  });

  it.each([
    [2815, 281.5, 2533.5],
    [1893, 189.3, 1703.7],
    [1885, 188.5, 1696.5],
  ])("settles the balance on a RM%d invoice (deposit %d, balance %d)", (face, deposit, balance) => {
    expect(
      classifyPopLeg({ popAmount: balance, ...collective(face, "DEPOSIT_PAID", deposit) }),
    ).toBe("balance");
  });

  it("reads a balance leg as balance even when it coincides with the deposit amount", () => {
    // A 50% deposit makes the balance equal the deposit. Reading it as another
    // deposit would leave the invoice open and invite a third payment.
    expect(
      classifyPopLeg({
        popAmount: 500,
        invoiceAmount: 1000,
        depositAmount: 500,
        amountPaid: 500,
        status: "DEPOSIT_PAID",
      }),
    ).toBe("balance");
  });

  it("still prefers a full-amount match over a balance reading", () => {
    // Invoice where the outstanding balance happens to equal the full amount is
    // impossible, but a full match must win wherever both could apply.
    expect(
      classifyPopLeg({
        popAmount: 1000,
        invoiceAmount: 1000,
        depositAmount: 100,
        amountPaid: 0,
        status: "PENDING",
      }),
    ).toBe("full");
  });

  it("does not invent a balance leg on an invoice with nothing paid", () => {
    expect(
      classifyPopLeg({ popAmount: 2533.5, ...collective(2815, "PENDING", 0) }),
    ).toBe("none");
  });

  it("does not match a balance on an already-settled invoice", () => {
    expect(
      classifyPopLeg({ popAmount: 2533.5, ...collective(2815, "PAID", 2815) }),
    ).toBe("none");
  });

  it("does not match when the invoice is fully paid but still flagged part-paid", () => {
    // Defensive: amountPaid == amount leaves nothing outstanding.
    expect(
      classifyPopLeg({
        popAmount: 100,
        invoiceAmount: 2815,
        depositAmount: null,
        amountPaid: 2815,
        status: "DEPOSIT_PAID",
      }),
    ).toBe("none");
  });

  it("honours the ±RM0.50 tolerance on the balance leg, and no more", () => {
    const base = collective(2815, "DEPOSIT_PAID", 281.5);
    expect(classifyPopLeg({ popAmount: 2533.9, ...base })).toBe("balance");
    expect(classifyPopLeg({ popAmount: 2533.0, ...base })).toBe("balance");
    expect(classifyPopLeg({ popAmount: 2534.5, ...base })).toBe("none");
    expect(classifyPopLeg({ popAmount: 2532.9, ...base })).toBe("none");
  });

  it("settles a balance on an INITIATED part-paid invoice — the live shape", () => {
    // As of 2026-09-17 the ONLY two part-paid invoices in the database are
    // INITIATED with 10% recorded, not DEPOSIT_PAID: IV-02187 (RM2,905, paid
    // RM290.50) and IV-02189 (RM1,953, paid RM195.30), RM4,372.20 outstanding
    // between them. Gating eligibility on the deposit statuses would miss
    // exactly the cases this fix exists for.
    expect(
      classifyPopLeg({
        popAmount: 2614.5,
        invoiceAmount: 2905,
        depositAmount: 290.5,
        amountPaid: 290.5,
        status: "INITIATED",
      }),
    ).toBe("balance");
    expect(
      classifyPopLeg({
        popAmount: 1757.7,
        invoiceAmount: 1953,
        depositAmount: 195.3,
        amountPaid: 195.3,
        status: "INITIATED",
      }),
    ).toBe("balance");
  });

  it("handles a PARTIALLY_PAID invoice from an ad-hoc part payment", () => {
    expect(
      classifyPopLeg({
        popAmount: 400,
        invoiceAmount: 1000,
        depositAmount: null,
        amountPaid: 600,
        status: "PARTIALLY_PAID",
      }),
    ).toBe("balance");
  });

  it("returns none for an unrelated amount", () => {
    expect(
      classifyPopLeg({ popAmount: 42, ...collective(2815, "DEPOSIT_PAID", 281.5) }),
    ).toBe("none");
  });
});
