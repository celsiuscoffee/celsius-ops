import { describe, it, expect } from "vitest";
import {
  addDays,
  amountDue,
  bankRowsToCheck,
  billHref,
  cashNote,
  daysBetween,
  dueWords,
  moneyTodayCounts,
  payrollHref,
  payrollPeriodKey,
  payrollTitle,
  rm,
  sortBills,
  timeWords,
  type BankMatch,
  type BillRow,
  type MoneyToday,
  type PayrollRow,
} from "./money-today";

const bill = (p: Partial<BillRow>): BillRow => ({
  id: "b", supplier: "Dankoff", invoiceNumber: "IV-1", outlet: "Shah Alam", dueDate: "2026-11-20", amountDue: 100, status: "PENDING", ...p,
});
const run = (p: Partial<PayrollRow>): PayrollRow => ({
  id: "r", cycle: "monthly", periodYear: 2026, periodMonth: 11, periodStart: null, periodEnd: null, net: 0, gross: 0, computedAt: null, ...p,
});
const match = (p: Partial<BankMatch>): BankMatch => ({
  invoiceId: "i", invoiceNumber: "IV-1", payee: "Dankoff", amount: 10, bankLineId: "l", bankDesc: "IBG DANKOFF", bankDate: "2026-11-18", score: 0.8, reasons: [], alreadyPaid: false, ...p,
});

describe("Money › Today dates", () => {
  it("counts whole days and adds days across a month end", () => {
    expect(daysBetween("2026-11-20", "2026-11-27")).toBe(7);
    expect(daysBetween("2026-11-20", "2026-11-16")).toBe(-4);
    expect(addDays("2026-11-28", 6)).toBe("2026-12-04");
  });

  it("says when a bill is due in words", () => {
    const today = "2026-11-20";
    expect(dueWords("2026-11-16", today)).toBe("Late, due Mon 16 Nov");
    expect(dueWords("2026-11-20", today)).toBe("Due today");
    expect(dueWords("2026-11-21", today)).toBe("Due tomorrow");
    expect(dueWords("2026-11-26", today)).toBe("Due Thu 26 Nov");
  });

  it("writes 12-hour Malaysia times", () => {
    expect(timeWords(new Date("2026-11-20T01:41:00Z"))).toBe("9:41 AM");
    expect(timeWords(new Date("2026-11-20T11:05:00Z"))).toBe("7:05 PM");
  });
});

describe("Money › Today money", () => {
  it("shows RM with two decimals", () => {
    expect(rm(1234.5)).toBe("RM 1,234.50");
    expect(rm(0)).toBe("RM 0.00");
  });

  it("owes what is left, never below zero", () => {
    expect(amountDue(500, 200)).toBe(300);
    expect(amountDue(100.105, null)).toBe(100.11);
    expect(amountDue(100, 150)).toBe(0);
  });

  it("names the bank statement date for cash in bank", () => {
    expect(cashNote("MAYBANK CURRENT 5123-4384 · as of 2026-11-18")).toBe("Bank statement of Wed 18 Nov");
    expect(cashNote(undefined)).toBe("From the latest bank statement");
  });
});

describe("Money › Today lists", () => {
  it("puts late bills first, then by due date, then the biggest", () => {
    const rows = sortBills([
      bill({ id: "c", dueDate: "2026-11-24", amountDue: 10 }),
      bill({ id: "b", dueDate: "2026-11-24", amountDue: 90 }),
      bill({ id: "a", dueDate: "2026-11-10" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("opens a bill on the Invoices page, filtered to that invoice", () => {
    expect(billHref(bill({ invoiceNumber: "IV 02/159" }))).toBe("/inventory/invoices?cardFilter=payable&search=IV%2002%2F159");
  });

  it("names payroll runs and opens their own page", () => {
    expect(payrollTitle(run({}))).toBe("November 2026 payroll");
    expect(payrollTitle(run({ cycle: "weekly", periodStart: "2026-11-09", periodEnd: "2026-11-15" }))).toBe("Part-timers, 9 – 15 Nov");
    expect(payrollTitle(run({ cycle: "weekly", periodStart: "2026-11-30", periodEnd: "2026-12-06" }))).toBe("Part-timers, 30 Nov – 6 Dec");
    expect(payrollHref(run({}))).toBe("/hr/payroll");
    expect(payrollHref(run({ cycle: "weekly" }))).toBe("/hr/payroll/weekly");
  });

  it("orders payroll runs oldest period first", () => {
    expect(payrollPeriodKey(run({ periodMonth: 9 }))).toBe("2026-09-01");
    expect(payrollPeriodKey(run({ cycle: "weekly", periodStart: "2026-11-09" }))).toBe("2026-11-09");
  });

  it("lists unsure bank matches biggest first", () => {
    const rows = bankRowsToCheck({ review: [match({ amount: 5 }), match({ amount: 50 })], doublePayments: [] });
    expect(rows.map((r) => r.amount)).toEqual([50, 5]);
    expect(bankRowsToCheck(undefined)).toEqual([]);
  });
});

describe("Money › Today key numbers", () => {
  const data: MoneyToday = {
    today: "2026-11-20", weekEnd: "2026-11-26",
    bills: [bill({ dueDate: "2026-11-18", amountDue: 100.25 }), bill({ dueDate: "2026-11-25", amountDue: 50 })],
    claims: [{ id: "claim:1", source: "claims", area: "Procurement", when: "week", title: "PR-1", from: "x", href: "/inventory/pay-and-claim", hrefLabel: "Open" }],
    payroll: [run({ net: 1000 }), run({ cycle: "weekly", net: 250.5 })],
    unavailable: [],
  };

  it("adds up every decision on the page", () => {
    const c = moneyTodayCounts(data, { review: [match({})], doublePayments: [match({ alreadyPaid: true })] });
    expect(c).toEqual({
      billsTotal: 150.25, billsCount: 2, billsLate: 1, claimsCount: 1,
      bankToCheck: 1, doublePayments: 1,
      payrollWaiting: 2, payrollNet: 1250.5,
      waiting: 2 + 1 + 1 + 1 + 2,
    });
  });

  it("is all clear when nothing waits", () => {
    const empty: MoneyToday = { ...data, bills: [], claims: [], payroll: [] };
    expect(moneyTodayCounts(empty, { review: [], doublePayments: [] }).waiting).toBe(0);
    expect(moneyTodayCounts(undefined, undefined).waiting).toBe(0);
  });
});
