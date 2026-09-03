import { describe, it, expect } from "vitest";
import { generatePayrollByOutlet, allocateByShares, type EmployeeRow } from "./files";

// The by-outlet file is what finance uses to recharge each outlet its labour
// cost, so the one property that matters is that it reconciles: every subtotal
// is the sum of its rows, the grand total is the sum of the subtotals, and
// "total cost" is gross + employer contributions — never just net.
function emp(over: Partial<EmployeeRow> & { name: string }): EmployeeRow {
  return {
    userId: over.name, fullName: null, icNumber: null, epfNumber: null, socsoNumber: null,
    eisNumber: null, taxNumber: null, bankName: null, bankAccountNumber: null, bankAccountName: null,
    wage: 0, epfEmployee: 0, epfEmployer: 0, socsoEmployee: 0, socsoEmployer: 0, eisEmployee: 0,
    eisEmployer: 0, pcbTax: 0, netPay: 0, gross: 0, ...over,
  };
}

const run = { period_month: 8, period_year: 2026 };
// columns: 0 Outlet, 1 Employee, 2 Share, 3 Basic, 4 Gross, 5 EPF (employee), 6 EPF (employer), 7 SOCSO, 8 EIS, 9 Contrib, 10 Cost, 11 Net
const col = (line: string, i: number) => line.split(",")[i];

describe("generatePayrollByOutlet", () => {
  it("groups by outlet A→Z with HQ last, and every subtotal + grand total reconciles", () => {
    const employees: EmployeeRow[] = [
      emp({ name: "Zed", outlet: "Tamarind", wage: 1900, gross: 2000, epfEmployee: 220, epfEmployer: 260, socsoEmployer: 30, eisEmployer: 4, netPay: 1750 }),
      emp({ name: "Amy", outlet: "Putrajaya", wage: 2100, gross: 2436.15, epfEmployee: 231, epfEmployer: 273, socsoEmployer: 42.85, eisEmployer: 4.9, netPay: 2169.65 }),
      emp({ name: "Bob", outlet: "Tamarind", wage: 1800, gross: 1800, epfEmployee: 198, epfEmployer: 234, socsoEmployer: 27, eisEmployer: 3.6, netPay: 1600 }),
      emp({ name: "Hq Person", outlet: null, wage: 10500, gross: 10600, epfEmployer: 1365, socsoEmployer: 60, eisEmployer: 12, netPay: 8338.8 }),
    ];
    const out = generatePayrollByOutlet(run, employees);
    const lines = out.content.trim().split("\n");

    expect(out.filename).toBe("PAYROLL_BY_OUTLET_202608.csv");
    expect(out.mime).toBe("text/csv");
    expect(out.summary.outlets).toBe(3);
    expect(out.summary.count).toBe(4);

    // Order: Putrajaya, Tamarind, then HQ last. Each outlet block ends in a SUBTOTAL row.
    expect(col(lines[1], 0)).toBe("Putrajaya");
    expect(col(lines[2], 1)).toContain("SUBTOTAL — Putrajaya");
    expect(col(lines[3], 0)).toBe("Tamarind");
    expect(col(lines[3], 1)).toBe("Bob"); // A→Z within the outlet
    expect(col(lines[4], 1)).toBe("Zed");
    expect(col(lines[5], 1)).toContain("SUBTOTAL — Tamarind (2 lines)");
    expect(col(lines[6], 0)).toBe("HQ / unassigned");

    // Tamarind subtotal = Zed + Bob, cost = gross + employer contribs.
    const tam = lines[5];
    expect(col(tam, 4)).toBe((2000 + 1800).toFixed(2));
    expect(col(tam, 5)).toBe((220 + 198).toFixed(2)); // EPF (employee) subtotal
    expect(col(tam, 9)).toBe((260 + 30 + 4 + 234 + 27 + 3.6).toFixed(2));
    expect(col(tam, 10)).toBe((2000 + 1800 + 260 + 30 + 4 + 234 + 27 + 3.6).toFixed(2));
    expect(col(tam, 11)).toBe((1750 + 1600).toFixed(2));

    // Grand total = sum of all four people, and matches the summary.
    const total = lines[lines.length - 1];
    expect(col(total, 1)).toBe("TOTAL (4 staff)");
    const cost = 2000 + 294 + 2436.15 + 320.75 + 1800 + 264.6 + 10600 + 1437;
    expect(col(total, 10)).toBe(cost.toFixed(2));
    expect(out.summary.total).toBe(Math.round(cost * 100) / 100);
  });

  it("splits a rotating staffer across outlets pro rata by shifts, to the cent (Syafiq, Aug 2026: 7/5/3)", () => {
    // Owner 2026-09-03: "for syafiq payroll, it should be divided based on the
    // shifts work in each outlet". Amounts from the August run.
    const syafiq = emp({
      name: "Syafiq Kaberi", outlet: null,
      wage: 3166.67, gross: 3344.87, epfEmployee: 369, epfEmployer: 435, socsoEmployer: 58.55, eisEmployer: 6.7, netPay: 2896.12,
      outletShares: [
        { outlet: "Shah Alam", shifts: 7 },
        { outlet: "Putrajaya", shifts: 5 },
        { outlet: "Tamarind", shifts: 3 },
      ],
    });
    const out = generatePayrollByOutlet(run, [syafiq]);
    const lines = out.content.trim().split("\n");
    const rows = lines.filter((l) => col(l, 1) === "Syafiq Kaberi");
    expect(rows).toHaveLength(3);
    expect(rows.map((l) => col(l, 2))).toEqual(["5/15 shifts", "7/15 shifts", "3/15 shifts"]); // Putrajaya, Shah Alam, Tamarind (A→Z)

    // The three portions sum EXACTLY to the person's totals.
    const sum = (i: number) => Math.round(rows.reduce((s, l) => s + Number(col(l, i)), 0) * 100) / 100;
    expect(sum(3)).toBe(3166.67);
    expect(sum(4)).toBe(3344.87);
    expect(sum(5)).toBe(369); // EPF (employee)
    expect(sum(6)).toBe(435);
    expect(sum(7)).toBe(58.55);
    expect(sum(8)).toBe(6.7);
    expect(sum(11)).toBe(2896.12);
    // Shah Alam carries 7/15 of gross: floors are 1560.93 + 1114.95 + 668.97 = 3344.85,
    // and the 2 leftover cents land on the largest share → 1560.95.
    const sa = rows.find((l) => col(l, 0) === "Shah Alam")!;
    expect(Number(col(sa, 4))).toBeCloseTo(1560.95, 2);

    // He is ONE person in the grand total, not three.
    expect(col(lines[lines.length - 1], 1)).toBe("TOTAL (1 staff)");
    expect(out.summary.count).toBe(1);
    expect(out.summary.total).toBe(Math.round((3344.87 + 435 + 58.55 + 6.7) * 100) / 100);
  });

  it("escapes commas/quotes in names so the CSV stays rectangular", () => {
    const out = generatePayrollByOutlet(run, [
      emp({ name: "A, \"Quoted\"", fullName: 'Ali, "The" Bin Abu', outlet: "Shah Alam", gross: 100, netPay: 90 }),
    ]);
    const row = out.content.split("\n")[1];
    expect(row.startsWith('Shah Alam,"Ali, ""The"" Bin Abu",')).toBe(true);
  });
});

describe("allocateByShares", () => {
  it("parts always sum to the whole; the rounding cent lands on the largest share", () => {
    const parts = allocateByShares(100, [1, 1, 1]);
    expect(parts.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 10);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });

  it("zero / empty shares allocate nothing", () => {
    expect(allocateByShares(100, [])).toEqual([]);
    expect(allocateByShares(100, [0, 0])).toEqual([0, 0]);
  });
});
