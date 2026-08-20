import { describe, it, expect } from "vitest";
import { allocateByOutlet, buildPaymentCsv, paymentReference } from "./payment-file";

describe("weekly PT payment file", () => {
  it("builds the reference as PTW + Monday DDMM + first name, capped at 20 chars", () => {
    expect(paymentReference("2026-07-20", "Nurayuni Binti Ibrahim")).toBe("PTW2007 NURAYUNI");
    expect(paymentReference("2026-07-20", "Muhammad Aiman Bin Mohd Roslan")).toBe("PTW2007 MUHAMMAD");
    expect(paymentReference("2026-07-20", "NUR QAISARA FARHANAH BINTI AZROLNIZAM").length).toBeLessThanOrEqual(20);
  });

  it("tags the reference with the outlet code when a PT is split, keeping the code intact", () => {
    const ref = paymentReference("2026-07-20", "Nurayuni Binti Ibrahim", "CC002");
    expect(ref.length).toBeLessThanOrEqual(20);
    expect(ref).toContain("CC002");
    // Two outlets → two distinct narrations for the same person.
    const a = paymentReference("2026-07-20", "Nurayuni Binti Ibrahim", "CC001");
    const b = paymentReference("2026-07-20", "Nurayuni Binti Ibrahim", "CC003");
    expect(a).not.toBe(b);
    // A long outlet code still survives (the first name is trimmed, not the code).
    const long = paymentReference("2026-07-20", "Muhammad Aiman Bin Mohd Roslan", "CF IOI Mall");
    expect(long.length).toBeLessThanOrEqual(20);
    expect(long).toContain("CFIOIMALL");
  });

  it("emits one CSV line per PT-outlet with 2dp amounts, an Outlet column and a header", () => {
    const csv = buildPaymentCsv([
      { name: "Nurayuni Binti Ibrahim", bankName: "Maybank", accountNumber: "151584286991", amount: 157.5, reference: "PTW2007 NURAYUNI", outlet: "Celsius Coffee Shah Alam" },
      { name: "Muhd Zarif Bin Abdul Rahman", bankName: "Maybank", accountNumber: "157081398923", amount: 202, reference: "PTW2007 MUHD", outlet: "Celsius Coffee Tamarind" },
    ]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Beneficiary Name,Bank,Account Number,Amount (RM),Recipient Reference,Outlet");
    expect(lines[1]).toContain("157.50");
    expect(lines[1]).toContain("Celsius Coffee Shah Alam");
    expect(lines[2]).toContain("202.00");
  });

  it("escapes commas/quotes in names so the CSV stays parseable", () => {
    const csv = buildPaymentCsv([
      { name: 'Lim "YL" Yean, Loong', bankName: "CIMB", accountNumber: "7077715822", amount: 90, reference: "PTW2007 LIM", outlet: "Celsius Coffee Shah Alam" },
    ]);
    expect(csv).toContain('"Lim ""YL"" Yean, Loong"');
  });

  describe("allocateByOutlet", () => {
    const key = (s: { start?: string }) => s.start ?? "";

    it("splits pay across outlets by each outlet's own shift pay", () => {
      const alloc = allocateByOutlet(
        [
          { paid_hours: 5, rate: 12, start: "A" }, // 60 at outlet A
          { paid_hours: 4, rate: 12, start: "B" }, // 48 at outlet B
        ],
        key,
        108,
      );
      const byKey = Object.fromEntries(alloc.map((b) => [b.outletKey, b.amount]));
      expect(byKey).toEqual({ A: 60, B: 48 });
    });

    it("reconciles rounding so the split sums EXACTLY to net_pay", () => {
      // 3 shifts that each round awkwardly; net_pay is the confirmed figure.
      const alloc = allocateByOutlet(
        [
          { paid_hours: 3.33, rate: 12.5, start: "A" }, // 41.625
          { paid_hours: 2.17, rate: 12.5, start: "B" }, // 27.125
          { paid_hours: 1.5, rate: 12.5, start: "A" }, // 18.75 (also A)
        ],
        key,
        87.5, // confirmed net_pay
      );
      const sum = alloc.reduce((s, b) => s + b.amount, 0);
      expect(Math.round(sum * 100) / 100).toBe(87.5);
    });

    it("returns a single bucket for a single-outlet PT", () => {
      const alloc = allocateByOutlet(
        [
          { paid_hours: 5, rate: 15, start: "A" },
          { paid_hours: 3, rate: 15, start: "A" },
        ],
        key,
        120,
      );
      expect(alloc).toHaveLength(1);
      expect(alloc[0]).toEqual({ outletKey: "A", amount: 120 });
    });

    it("returns [] when there are no positive-pay shifts (caller falls back)", () => {
      expect(allocateByOutlet([], key, 0)).toEqual([]);
      expect(allocateByOutlet([{ paid_hours: 0, rate: 15, start: "A" }], key, 0)).toEqual([]);
    });

    it("buckets shifts with an unresolved outlet under the empty-string key", () => {
      const alloc = allocateByOutlet(
        [
          { paid_hours: 4, rate: 10, start: "A" }, // 40 at A
          { paid_hours: 2, rate: 10, start: undefined }, // 20 unresolved
        ],
        (s) => (s.start === "A" ? "A" : ""),
        60,
      );
      const byKey = Object.fromEntries(alloc.map((b) => [b.outletKey, b.amount]));
      expect(byKey).toEqual({ A: 40, "": 20 });
    });
  });
});
