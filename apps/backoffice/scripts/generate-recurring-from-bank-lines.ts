/* eslint-disable @typescript-eslint/no-require-imports */
// Generate per-outlet RecurringExpense entries from bank-line history.
//
// Why: the 4 manual HQ aggregates ("Rent (HQ aggregate) RM 15k") generalize
// across outlets and don't reflect actual per-outlet payment patterns.
// This script analyzes the last 90 days of classified bank lines, groups
// them by (outletId, category, month), and emits one RecurringExpense per
// (outlet, category) with:
//   - amount = average monthly total for that outlet+category
//   - nextDueDate = next occurrence at the most-recent day-of-month
//   - cadence = MONTHLY (only categories with consistent monthly cadence)
//
// Categories considered MONTHLY recurring: RENT, UTILITIES, SOFTWARE,
// EMPLOYEE_SALARY, DIRECTORS_ALLOWANCE, STATUTORY_PAYMENT, COMPLIANCE,
// TAX, MAINTENANCE, LICENSING_FEE, ROYALTY_FEE, BANK_FEE, CFS_FEE,
// LOAN, MANAGEMENT_FEE.
//
// Skipped (not monthly-recurring):
//   - PARTIMER (weekly/bi-weekly — projected via daily rate instead)
//   - STAFF_CLAIM, PETTY_CASH (irregular)
//   - DIGITAL_ADS, KOL, OTHER_MARKETING (variable timing)
//   - CARD/QR/STOREHUB/etc (sales — DOW shaped)
//   - RAW_MATERIALS, DELIVERY (multiple times per week)
//   - OTHER_OUTFLOW, OTHER_INFLOW (catch-all)
//
// Idempotent: drops all existing RecurringExpense rows and rebuilds.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MONTHLY_CATEGORIES_MAP: Record<string, "RENT" | "UTILITY" | "SAAS" | "PAYROLL_SUPPORT" | "OTHER"> = {
  // Property
  RENT:               "RENT",
  UTILITIES:          "UTILITY",
  SOFTWARE:           "SAAS",
  // Payroll
  EMPLOYEE_SALARY:    "PAYROLL_SUPPORT",
  DIRECTORS_ALLOWANCE:"PAYROLL_SUPPORT",
  STATUTORY_PAYMENT:  "PAYROLL_SUPPORT",
  // Other recurring
  COMPLIANCE:         "OTHER",
  TAX:                "OTHER",
  MAINTENANCE:        "OTHER",
  LICENSING_FEE:      "OTHER",
  ROYALTY_FEE:        "OTHER",
  BANK_FEE:           "OTHER",
  CFS_FEE:            "OTHER",
  LOAN:               "OTHER",
  MANAGEMENT_FEE:     "OTHER",
};

const FRIENDLY_NAME: Record<string, string> = {
  RENT:               "Rent",
  UTILITIES:          "Utilities",
  SOFTWARE:           "Software / SaaS",
  EMPLOYEE_SALARY:    "Salary",
  DIRECTORS_ALLOWANCE:"Directors' allowance",
  STATUTORY_PAYMENT:  "Statutory (EPF/SOCSO)",
  COMPLIANCE:         "Compliance / Legal",
  TAX:                "Tax",
  MAINTENANCE:        "Maintenance",
  LICENSING_FEE:      "Licensing fee",
  ROYALTY_FEE:        "Royalty fee",
  BANK_FEE:           "Bank fees",
  CFS_FEE:            "CFS fee",
  LOAN:               "Loan repayment",
  MANAGEMENT_FEE:     "Management fee",
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = new Date(today.getTime() - 90 * 86_400_000);

  // Pull last 90 days of DR lines in monthly categories
  const lines = await prisma.bankStatementLine.findMany({
    where: {
      direction: "DR",
      isInterCo: false,
      txnDate: { gte: since, lte: today },
      category: { in: Object.keys(MONTHLY_CATEGORIES_MAP) as never },
    },
    select: { txnDate: true, amount: true, category: true, outletId: true, description: true },
  });

  // Per (outletId, category): keep month-by-month totals + last
  // payment date per month. We use the latest month's TOTAL (handles
  // multi-line categories like SALARY = many staff payments) but
  // skip months whose total is < 30% of the largest historical month
  // (filters out partial/noisy months — e.g. April HQ rent that
  // only had a RM 399 ice-machine rental, not the actual landlord
  // payment).
  type CatBucket = {
    outletId: string;
    category: string;
    months: Map<string, { total: number; latestDate: Date; latestLineAmount: number; latestDescription: string }>;
  };
  const perCategory = new Map<string, CatBucket>();
  for (const l of lines) {
    const oid = l.outletId ?? "__HQ__";
    const k = `${oid}|${l.category}`;
    if (!perCategory.has(k)) {
      perCategory.set(k, { outletId: oid, category: l.category as string, months: new Map() });
    }
    const cb = perCategory.get(k)!;
    const monthKey = `${l.txnDate.getFullYear()}-${String(l.txnDate.getMonth() + 1).padStart(2, "0")}`;
    const m = cb.months.get(monthKey);
    if (!m) {
      cb.months.set(monthKey, { total: Number(l.amount), latestDate: l.txnDate, latestLineAmount: Number(l.amount), latestDescription: l.description });
    } else {
      m.total += Number(l.amount);
      if (l.txnDate > m.latestDate) {
        m.latestDate = l.txnDate;
        m.latestLineAmount = Number(l.amount);
        m.latestDescription = l.description;
      }
    }
  }

  // For each (outletId, category) with >= 2 months of history, emit a
  // RecurringExpense. Skip if only 1 month — could be one-off.
  const outlets = await prisma.outlet.findMany({ select: { id: true, name: true } });
  const outletNameById = new Map(outlets.map((o) => [o.id, o.name]));

  type Emit = {
    name: string;
    category: "RENT" | "UTILITY" | "SAAS" | "PAYROLL_SUPPORT" | "OTHER";
    amount: number;
    cadence: "MONTHLY";
    nextDueDate: Date;
    outletId: string | null;
    notes: string;
  };
  const emits: Emit[] = [];

  for (const cb of perCategory.values()) {
    if (cb.months.size < 2) continue;            // not yet recurring — skip

    // Sort months descending and find the latest "non-noisy" month —
    // total >= 30% of the largest month's total. Filters out months
    // where only a small one-off line hit this category (e.g. ice
    // machine rental classified as RENT).
    const monthsArr = Array.from(cb.months.entries())
      .sort(([a], [b]) => b.localeCompare(a));
    const maxMonthTotal = Math.max(...monthsArr.map(([, m]) => m.total));
    const threshold = maxMonthTotal * 0.3;
    const sigMonth = monthsArr.find(([, m]) => m.total >= threshold);
    if (!sigMonth) continue;
    const [latestMonth, latestMonthData] = sigMonth;

    const projectionAmount = latestMonthData.total;
    if (projectionAmount < 50) continue;         // ignore tiny noise

    // Day-of-month from the most-recent line in that month
    const dayOfMonth = latestMonthData.latestDate.getDate();
    const next = new Date(today.getFullYear(), today.getMonth(), Math.min(28, dayOfMonth));
    if (next <= today) next.setMonth(next.getMonth() + 1);

    const outletId = cb.outletId === "__HQ__" ? null : cb.outletId;
    const outletLabel = outletId ? outletNameById.get(outletId) ?? "outlet" : "HQ";
    const friendly = FRIENDLY_NAME[cb.category] ?? cb.category;
    const recurringCat = MONTHLY_CATEGORIES_MAP[cb.category];

    emits.push({
      name: `${friendly} — ${outletLabel}`,
      category: recurringCat,
      amount: Math.round(projectionAmount * 100) / 100,
      cadence: "MONTHLY",
      nextDueDate: next,
      outletId,
      notes: `Auto-generated from bank-line history. Latest month: ${latestMonth} = RM ${projectionAmount.toFixed(2)}. ${cb.months.size} months observed: ${monthsArr.map(([k, v]) => `${k}=${v.total.toFixed(0)}`).join(", ")}.`,
    });
  }

  emits.sort((a, b) => (a.outletId ?? "").localeCompare(b.outletId ?? "") || a.category.localeCompare(b.category));

  // Wipe existing entries and rebuild
  const wiped = await prisma.recurringExpense.deleteMany({});
  console.log(`[reset] deleted ${wiped.count} existing RecurringExpense entries`);

  if (emits.length === 0) {
    console.log("No entries to create.");
    await prisma.$disconnect();
    return;
  }

  const created = await prisma.recurringExpense.createMany({
    data: emits.map((e) => ({ ...e, isActive: true })),
  });
  console.log(`[ok] created ${created.count} per-outlet RecurringExpense entries`);

  console.log("\n--- Generated entries ---");
  for (const e of emits) {
    const outletLabel = e.outletId ? (outletNameById.get(e.outletId) ?? e.outletId) : "HQ";
    console.log(`  ${outletLabel.padEnd(28)} | ${e.category.padEnd(15)} | RM ${e.amount.toFixed(2).padStart(10)} | due ${ymd(e.nextDueDate)} | ${e.name}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
