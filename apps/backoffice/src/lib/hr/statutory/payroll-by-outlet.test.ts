import { describe, it, expect } from "vitest";
import { generatePayrollByOutlet, type EmployeeRow } from "./files";

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

describe("generatePayrollByOutlet", () => {
  it("groups by outlet A→Z with HQ last, and every subtotal + grand total reconciles", () => {
    const employees: EmployeeRow[] = [
      emp({ name: "Zed", outlet: "Tamarind", wage: 1900, gross: 2000, epfEmployer: 260, socsoEmployer: 30, eisEmployer: 4, netPay: 1750 }),
      emp({ name: "Amy", outlet: "Putrajaya", wage: 2100, gross: 2436.15, epfEmployer: 273, socsoEmployer: 42.85, eisEmployer: 4.9, netPay: 2169.65 }),
      emp({ name: "Bob", outlet: "Tamarind", wage: 1800, gross: 1800, epfEmployer: 234, socsoEmployer: 27, eisEmployer: 3.6, netPay: 1600 }),
      emp({ name: "Hq Person", outlet: null, wage: 10500, gross: 10600, epfEmployer: 1365, socsoEmployer: 60, eisEmployer: 12, netPay: 8338.8 }),
    ];
    const out = generatePayrollByOutlet(run, employees);
    const lines = out.content.trim().split("\n");

    expect(out.filename).toBe("PAYROLL_BY_OUTLET_202608.csv");
    expect(out.mime).toBe("text/csv");
    expect(out.summary.outlets).toBe(3);
    expect(out.summary.count).toBe(4);

    // Order: Putrajaya, Tamarind, then HQ last. Each outlet block ends in a SUBTOTAL row.
    const outletCol = lines.slice(1).map((l) => l.split(",")[0]);
    expect(outletCol[0]).toBe("Putrajaya");
    expect(lines[2].split(",")[1]).toContain("SUBTOTAL — Putrajaya");
    expect(outletCol[3]).toBe("Tamarind"); // Bob (A→Z within the outlet)
    expect(lines[3].split(",")[1]).toBe("Bob");
    expect(lines[4].split(",")[1]).toBe("Zed");
    expect(lines[5].split(",")[1]).toContain("SUBTOTAL — Tamarind (2 staff)");
    expect(lines[6].split(",")[0]).toBe("HQ / unassigned");

    // Tamarind subtotal = Zed + Bob, cost = gross + employer contribs.
    const tam = lines[5].split(",");
    // columns: Outlet,Employee,Basic,Gross,EPF,SOCSO,EIS,Contrib,Cost,Net
    expect(tam[3]).toBe((2000 + 1800).toFixed(2));
    expect(tam[7]).toBe((260 + 30 + 4 + 234 + 27 + 3.6).toFixed(2));
    expect(tam[8]).toBe((2000 + 1800 + 260 + 30 + 4 + 234 + 27 + 3.6).toFixed(2));
    expect(tam[9]).toBe((1750 + 1600).toFixed(2));

    // Grand total = sum of all four people, and matches the summary.
    const total = lines[lines.length - 1].split(",");
    expect(total[1]).toBe("TOTAL (4 staff)");
    const cost = 2000 + 294 + 2436.15 + 320.75 + 1800 + 264.6 + 10600 + 1437;
    expect(total[8]).toBe(cost.toFixed(2));
    expect(out.summary.total).toBe(Math.round(cost * 100) / 100);
  });

  it("escapes commas/quotes in names so the CSV stays rectangular", () => {
    const out = generatePayrollByOutlet(run, [
      emp({ name: "A, \"Quoted\"", fullName: 'Ali, "The" Bin Abu', outlet: "Shah Alam", gross: 100, netPay: 90 }),
    ]);
    const row = out.content.split("\n")[1];
    expect(row.startsWith('Shah Alam,"Ali, ""The"" Bin Abu",')).toBe(true);
  });
});
