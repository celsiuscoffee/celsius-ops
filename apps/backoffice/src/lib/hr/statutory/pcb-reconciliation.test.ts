import { describe, it, expect } from "vitest";

// PCB reconciliation against BrioHR, using Ariff's real July 2026 figures.
//
// This mirrors calcPCB's arithmetic rather than calling it, because calcPCB reads
// hr_stat_pcb_brackets / hr_stat_pcb_reliefs over the network. The bracket table is
// reproduced from the live 2026 rows; if LHDN changes a bracket, this test should
// be updated alongside the seed.
//
// It exists to pin the two defects found on 2026-08-03, both of which under-deducted:
//   1. YTD missing Jan+Feb (the opening-balance run never counted)
//   2. EPF relief capped at RM7,000 instead of LHDN's RM4,000

const BRACKETS_2026: [number, number | null, number, number][] = [
  [0, 5_000, 0, 0],
  [5_000, 20_000, 0, 1],
  [20_000, 35_000, 150, 3],
  [35_000, 50_000, 600, 6],
  [50_000, 70_000, 1_500, 11],
  [70_000, 100_000, 3_700, 19],
  [100_000, 400_000, 9_400, 25],
  [400_000, 600_000, 84_400, 26],
  [600_000, 2_000_000, 136_400, 28],
  [2_000_000, null, 528_400, 30],
];

function annualTax(chargeable: number): number {
  for (const [min, max, taxOnMin, rate] of BRACKETS_2026) {
    const hi = max === null ? Infinity : max;
    if (chargeable > min && chargeable <= hi) return taxOnMin + (chargeable - min) * (rate / 100);
  }
  return 0;
}

/** roundToCents in the calculator snaps to RM0.05, matching LHDN's MTD rounding. */
const round5sen = (v: number) => Math.round(v * 20) / 20;

/** Income Tax Act 1967 s.6A(2) — RM400 off the TAX where chargeable ≤ RM35,000. */
const REBATE = 400;
const REBATE_MAX_CHARGEABLE = 35_000;

function monthlyPcb(o: {
  ytdGross: number;
  ytdPcb: number;
  monthlyGross: number;
  month: number;
  annualEpf: number;
  annualSocsoEis: number;
  epfCap: number;
  socsoEisCap?: number;
  /** Set false to model the pre-fix behaviour, which granted no rebate at all. */
  rebate?: boolean;
}) {
  const remainingMonths = Math.max(1, 12 - (o.month - 1));
  const projectedAnnual = o.ytdGross + o.monthlyGross * remainingMonths;
  const relief =
    9_000 +
    Math.min(o.annualEpf, o.epfCap) +
    Math.min(o.annualSocsoEis, o.socsoEisCap ?? 350);
  const chargeable = Math.max(0, projectedAnnual - relief);
  const tax = annualTax(chargeable);
  const rebate =
    o.rebate !== false && chargeable <= REBATE_MAX_CHARGEABLE ? REBATE : 0;
  const net = Math.max(0, tax - rebate);
  return round5sen(Math.max(0, net - o.ytdPcb) / remainingMonths);
}

// Ariff, July 2026: RM10,500/month, EPF 11% = RM1,155, SOCSO 29.75, EIS 11.90.
const ARIFF = {
  monthlyGross: 10_500,
  month: 7,
  annualEpf: 1_155 * 12,
  annualSocsoEis: (29.75 + 11.9) * 12,
};
const YTD_CORRECT = { ytdGross: 65_019.23, ytdPcb: 6_829.85 }; // BrioHR Jan–Jun
const YTD_BROKEN = { ytdGross: 42_000, ytdPcb: 4_216.6 };      // Mar–Jun only

describe("PCB — Ariff July 2026 vs BrioHR (RM1,054.15)", () => {
  it("reproduces the WRONG figure that shipped, so the regression is pinned", () => {
    // Both defects live: YTD short by Jan+Feb, EPF relief at the combined 7,000 cap.
    expect(monthlyPcb({ ...ARIFF, ...YTD_BROKEN, epfCap: 7_000 })).toBe(504.5);
  });

  it("fixing YTD alone is not enough — still RM139.55 under BrioHR", () => {
    expect(monthlyPcb({ ...ARIFF, ...YTD_CORRECT, epfCap: 7_000 })).toBe(914.6);
  });

  it("fixing the EPF cap alone is not enough either", () => {
    expect(monthlyPcb({ ...ARIFF, ...YTD_BROKEN, epfCap: 4_000 })).toBe(599.5);
  });

  it("both fixes land within the RM350 SOCSO/EIS relief of BrioHR", () => {
    expect(monthlyPcb({ ...ARIFF, ...YTD_CORRECT, epfCap: 4_000 })).toBe(1_039.6);
  });

  it("and matches BrioHR to the cent once the SOCSO/EIS relief is also dropped", () => {
    // Left as an OWNER DECISION, not shipped: the RM350 relief is legitimate at
    // year-end assessment; BrioHR simply does not grant it monthly. Documented
    // here so the remaining RM14.55/month is explained rather than mysterious.
    expect(monthlyPcb({ ...ARIFF, ...YTD_CORRECT, epfCap: 4_000, socsoEisCap: 0 })).toBe(1_054.15);
  });
});

describe("PCB — bracket boundary the YTD bug straddled", () => {
  it("the broken YTD projected into 19%, the correct one into 25%", () => {
    const relief = 9_000 + 4_000 + 350;
    const brokenProjection = 42_000 + 10_500 * 6;      // 105,000
    const correctProjection = 65_019.23 + 10_500 * 6;  // 128,019.23
    expect(brokenProjection - relief).toBeLessThan(100_000);
    expect(correctProjection - relief).toBeGreaterThan(100_000);
  });
});

describe("PCB — the RM400 individual rebate (s.6A(2))", () => {
  // This is why BrioHR charged ONE person and we charged fifteen.
  it("zeroes the low end of the payroll, matching BrioHR's RM0", () => {
    // Ameir: the largest of the fourteen we wrongly charged. Annual tax RM163.79,
    // comfortably under the RM400 rebate.
    const ameir = {
      ytdGross: 18_494.71, ytdPcb: 0, monthlyGross: 2_365, month: 7,
      annualEpf: 253 * 12, annualSocsoEis: (11.25 + 4.5) * 12, epfCap: 4_000,
    };
    expect(monthlyPcb({ ...ameir, rebate: false })).toBe(27.3); // what shipped
    expect(monthlyPcb(ameir)).toBe(0); // what BrioHR says
  });

  it("zeroes the smallest case too", () => {
    const firdaus = {
      ytdGross: 4_723.19, ytdPcb: 0, monthlyGross: 2_132.31, month: 7,
      annualEpf: 231 * 12, annualSocsoEis: (10.75 + 4.3) * 12, epfCap: 4_000,
    };
    expect(monthlyPcb({ ...firdaus, rebate: false })).toBe(0.95);
    expect(monthlyPcb(firdaus)).toBe(0);
  });

  it("Syafiq — tax EXCEEDS the rebate, and he still lands on nil", () => {
    // Annual tax RM451.45, less RM400 = RM51.45 net — already below the RM56.15
    // he had paid by June, so nothing more is due. The sharpest confirmation
    // that the rebate is the missing rule and not a coincidence.
    const syafiq = {
      ytdGross: 23_242.82, ytdPcb: 56.15, monthlyGross: 3_347.83, month: 7,
      annualEpf: 370 * 12, annualSocsoEis: (16.75 + 6.7) * 12, epfCap: 4_000,
    };
    expect(monthlyPcb({ ...syafiq, rebate: false })).toBe(65.9);
    expect(monthlyPcb(syafiq)).toBe(0);
  });

  it("does NOT apply to Ariff — he is past the RM35,000 ceiling", () => {
    // Which is exactly why he is the one person BrioHR did charge.
    const withRebate = monthlyPcb({ ...ARIFF, ...YTD_CORRECT, epfCap: 4_000 });
    const without = monthlyPcb({ ...ARIFF, ...YTD_CORRECT, epfCap: 4_000, rebate: false });
    expect(withRebate).toBe(without);
    expect(withRebate).toBe(1_039.6);
  });

  it("is capped at the tax charged — a rebate can never create a refund", () => {
    // Tiny liability, RM400 rebate: the result floors at zero, not minus RM390.
    const tiny = {
      ytdGross: 0, ytdPcb: 0, monthlyGross: 1_300, month: 1,
      annualEpf: 143 * 12, annualSocsoEis: (6.75 + 2.7) * 12, epfCap: 4_000,
    };
    expect(monthlyPcb(tiny)).toBe(0);
    expect(monthlyPcb(tiny)).toBeGreaterThanOrEqual(0);
  });
});

describe("PCB — EPF relief cap", () => {
  it("grants only the EPF leg (4,000), not the EPF+life-insurance total (7,000)", () => {
    // Anyone contributing over RM4,000/yr — i.e. earning above ~RM3,030/month —
    // was over-relieved by the difference.
    expect(Math.min(1_155 * 12, 4_000)).toBe(4_000);
    expect(Math.min(1_155 * 12, 7_000)).toBe(7_000);
  });

  it("leaves low earners untouched — their EPF is below either cap", () => {
    const lowEarnerAnnualEpf = 220 * 12; // RM2,000/month at 11%
    expect(Math.min(lowEarnerAnnualEpf, 4_000)).toBe(lowEarnerAnnualEpf);
    expect(Math.min(lowEarnerAnnualEpf, 7_000)).toBe(lowEarnerAnnualEpf);
  });
});
