import { describe, it, expect } from "vitest";
import { buildPaymentCsv, paymentReference } from "./payment-file";

describe("weekly PT payment file", () => {
  it("builds the reference as PTW + Monday DDMM + first name, capped at 20 chars", () => {
    expect(paymentReference("2026-07-20", "Nurayuni Binti Ibrahim")).toBe("PTW2007 NURAYUNI");
    expect(paymentReference("2026-07-20", "Muhammad Aiman Bin Mohd Roslan")).toBe("PTW2007 MUHAMMAD");
    expect(paymentReference("2026-07-20", "NUR QAISARA FARHANAH BINTI AZROLNIZAM").length).toBeLessThanOrEqual(20);
  });

  it("emits one CSV line per PT with 2dp amounts and a header", () => {
    const csv = buildPaymentCsv([
      { name: "Nurayuni Binti Ibrahim", bankName: "Maybank", accountNumber: "151584286991", amount: 157.5, reference: "PTW2007 NURAYUNI" },
      { name: "Muhd Zarif Bin Abdul Rahman", bankName: "Maybank", accountNumber: "157081398923", amount: 202, reference: "PTW2007 MUHD" },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Beneficiary Name,Bank,Account Number,Amount (RM),Recipient Reference");
    expect(lines[1]).toContain("157.50");
    expect(lines[2]).toContain("202.00");
  });

  it("escapes commas/quotes in names so the CSV stays parseable", () => {
    const csv = buildPaymentCsv([
      { name: 'Lim "YL" Yean, Loong', bankName: "CIMB", accountNumber: "7077715822", amount: 90, reference: "PTW2007 LIM" },
    ]);
    expect(csv).toContain('"Lim ""YL"" Yean, Loong"');
  });
});
