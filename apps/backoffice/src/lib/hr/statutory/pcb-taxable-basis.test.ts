import { describe, it, expect } from "vitest";

// PCB is assessed on TAXABLE income, not on everything paid.
//
// hr_payroll_item_catalog marks each item pcb_taxable. The calculator fetched
// that flag and never read it, so a non-taxable payment — a mileage
// reimbursement, a parking or meal allowance, a non-taxable perquisite — went
// into the PCB basis and was taxed.
//
// These pin the arithmetic with Adam Kelvin's real final payslip, where it cost
// him RM9.45 on a run that can't be re-issued.

const BRACKETS_2026: [number, number | null, number, number][] = [
  [0, 5_000, 0, 0],
  [5_000, 20_000, 0, 1],
  [20_000, 35_000, 150, 3],
  [35_000, 50_000, 600, 6],
  [50_000, 70_000, 1_500, 11],
  [70_000, 100_000, 3_700, 19],
  [100_000, 400_000, 9_400, 25],
];

function annualTax(chargeable: number): number {
  for (const [min, max, taxOnMin, rate] of BRACKETS_2026) {
    const hi = max === null ? Infinity : max;
    if (chargeable > min && chargeable <= hi) return taxOnMin + (chargeable - min) * (rate / 100);
  }
  return 0;
}
const round5sen = (v: number) => Math.round(v * 20) / 20;

/** Mirrors the shipped calc: relief, s.6A(2) rebate, spread over remaining months. */
function monthlyPcb(o: {
  ytdGross: number; ytdPcb: number; monthlyGross: number; month: number;
  annualEpf: number; annualSocsoEis: number;
}) {
  const remaining = Math.max(1, 12 - (o.month - 1));
  const projected = o.ytdGross + o.monthlyGross * remaining;
  const relief = 9_000 + Math.min(o.annualEpf, 4_000) + Math.min(o.annualSocsoEis, 350);
  const chargeable = Math.max(0, projected - relief);
  const tax = annualTax(chargeable);
  const net = Math.max(0, tax - (chargeable <= 35_000 ? 400 : 0));
  return round5sen(Math.max(0, net - o.ytdPcb) / remaining);
}

// Adam Kelvin's final payslip, Jul 2026: basic 3,900 + 450 AL encashment
// (taxable) + 315 mileage reimbursement (NOT taxable).
const ADAM = {
  ytdGross: 18_606.60, ytdPcb: 20.20, month: 7,
  annualEpf: 429 * 12, annualSocsoEis: (19.25 + 7.7) * 12,
};

describe("PCB basis excludes non-taxable payments", () => {
  it("reproduces the WRONG figure that shipped, with the reimbursement taxed", () => {
    expect(monthlyPcb({ ...ADAM, monthlyGross: 4_665 })).toBe(21.35);
  });

  it("drops to the correct figure once the reimbursement is excluded", () => {
    expect(monthlyPcb({ ...ADAM, monthlyGross: 4_350 })).toBe(11.9);
  });

  it("the difference is the RM9.45 over-deduction on a final payslip", () => {
    const wrong = monthlyPcb({ ...ADAM, monthlyGross: 4_665 });
    const right = monthlyPcb({ ...ADAM, monthlyGross: 4_350 });
    expect(Number((wrong - right).toFixed(2))).toBe(9.45);
  });

  it("the taxable AL encashment still IS taxed — this isn't a blanket exclusion", () => {
    const withEncashment = monthlyPcb({ ...ADAM, monthlyGross: 4_350 });
    const withoutEncashment = monthlyPcb({ ...ADAM, monthlyGross: 3_900 });
    expect(withEncashment).toBeGreaterThan(withoutEncashment);
  });
});

describe("pcbGross derivation", () => {
  const pcbGross = (gross: number, nonTaxable: number) =>
    Math.max(0, Math.round((gross - nonTaxable) * 100) / 100);

  it("subtracts only the non-taxable additions", () => {
    expect(pcbGross(4_665, 315)).toBe(4_350);
  });

  it("leaves an all-taxable payslip untouched", () => {
    expect(pcbGross(3_900, 0)).toBe(3_900);
  });

  it("never goes negative, even if the non-taxable part exceeds gross", () => {
    // Reimbursement-only month with heavy unpaid leave: basis floors at 0,
    // it does not become a negative income that would offset other months.
    expect(pcbGross(200, 315)).toBe(0);
  });

  it("keeps cents exact rather than accumulating float error", () => {
    expect(pcbGross(4_665.55, 315.15)).toBe(4_350.4);
  });
});
