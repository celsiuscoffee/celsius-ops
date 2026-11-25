import { describe, it, expect } from "vitest";
import { priorYearArrears, generateEAFormCSV, generateFormE_CP8D, type EARecord } from "./annual";

describe("priorYearArrears (EA B.2)", () => {
  it("picks up arrears tagged with an earlier year", () => {
    const r = priorYearArrears(
      { ARREARS_OF_SALARY: { amount: 1826.92, relates_to_year: 2025 }, BONUS: { amount: 500 } },
      2026,
    );
    expect(r).toEqual({ amount: 1826.92, years: [2025] });
  });

  it("leaves untagged and same-year arrears in B.1", () => {
    expect(priorYearArrears({ "Arrears Of Salary": { amount: 1826.92 } }, 2026).amount).toBe(0);
    expect(priorYearArrears({ ARREARS_OF_SALARY: { amount: 300, relates_to_year: 2026 } }, 2026).amount).toBe(0);
  });

  it("ignores negative and junk entries", () => {
    expect(priorYearArrears({ A: { amount: -50, relates_to_year: 2025 }, B: null, C: { amount: 10, relates_to_year: "x" } }, 2026).amount).toBe(0);
    expect(priorYearArrears(null, 2026)).toEqual({ amount: 0, years: [] });
  });
});

describe("EA / CP8D output with B.2", () => {
  const rec: EARecord = {
    userId: "u1", name: "Hidayat", fullName: "Nur Hidayat", icNumber: "890304105387", taxNumber: "SG1",
    epfNumber: null, socsoNumber: null, commencementDate: "2025-12-01", ceasedDate: "2026-04-27",
    cp8dStatus: "Permanent", grossRemuneration: 36704.55, feesCommissions: 0, otherAllowances: 0,
    esopBenefit: 0, priorYearArrears: 1826.92, priorYearArrearsYears: [2025], bikValue: 0,
    livingAccommodation: 0, epfEmployee: 4257, socsoEmployee: 119, pcbTax: 3215.1, cp38Deduction: 0, zakat: 0,
  };
  const company = { name: "Celsius Coffee Sdn. Bhd.", ssm: null, employerNo: null };

  it("EA CSV has B.2 amount and year columns", () => {
    const [header, row] = generateEAFormCSV(2026, [rec], company).content.split("\r\n");
    const h = header.split(","), r = row.split(",");
    expect(r[h.indexOf("B.2 Prior-Year Arrears")]).toBe("1826.92");
    expect(r[h.indexOf("B.2 Relates To Year")]).toBe("2025");
    expect(r[h.indexOf("B.1(a) Gross")]).toBe("36704.55");
  });

  it("CP8D gross still includes the arrears (paid this year)", () => {
    const out = generateFormE_CP8D(2026, [rec], company);
    expect(out.summary.gross).toBeCloseTo(38531.47, 2);
  });
});
