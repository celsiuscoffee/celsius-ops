// Payables forecast — what cash is committed to leave, and when.
//
// The outgoing mirror of settlement-forecast: instead of "when does rung
// revenue land", this answers "what do we owe, due on which day". Two sources:
//
//   Invoices    — unpaid supplier/vendor invoices (procurement AP + asset /
//                 maintenance requests), bucketed on their due date. Remaining
//                 amount honours partial payments and deposits, same rules as
//                 the weekly projection in cashflow.ts.
//   Recurring   — active RecurringExpense entries (rent, utilities, SaaS,
//                 payroll support, loans/tax under OTHER) expanded onto their
//                 actual due dates inside the window. These are the same rows
//                 the weekly projection fires, so the day view and the week
//                 view agree.
//
// Anything past-due (or unpaid with no due date on record) is reported in a
// standing `overdue` block relative to TODAY, independent of the requested
// window — a late invoice is payable now no matter what range is on screen.

import { prisma } from "@/lib/prisma";

export type PayableSource = "invoice" | "recurring";

export type PayableCategory =
  | "ingredients" | "asset" | "maintenance"
  | "rent" | "utilities" | "software" | "payroll"
  | "other";

export const PAYABLE_CATEGORY_LABEL: Record<PayableCategory, string> = {
  ingredients: "Ingredients",
  asset: "Asset",
  maintenance: "Maintenance",
  rent: "Rent",
  utilities: "Utilities",
  software: "Software",
  payroll: "Payroll",
  other: "Other",
};

export type PayableItem = {
  id: string;               // invoice id, or `${recurringId}:${dueDate}` per occurrence
  source: PayableSource;
  dueDate: string | null;   // YYYY-MM-DD (MYT); null = unpaid invoice with no due date
  payee: string;
  ref: string | null;       // supplier invoice number
  category: PayableCategory;
  outletId: string | null;
  amount: number;           // remaining to pay
  status: string;           // invoice status, or "scheduled" for recurring
  overdue: boolean;
};

export type PayablesForecast = {
  from: string;
  to: string;
  items: PayableItem[];     // due inside [from, to], sorted by dueDate
  overdue: { total: number; count: number; items: PayableItem[] };
  byDate: { date: string; total: number; count: number; byCategory: Partial<Record<PayableCategory, number>> }[];
  byCategory: { category: PayableCategory; total: number }[];
  total: number;            // sum of items (window only, excludes overdue)
  invoiceTotal: number;
  recurringTotal: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// MYT calendar date of a stored timestamp. Due dates are written either as
// midnight UTC or midnight MYT depending on the writer; +8h maps both onto
// the intended Malaysian calendar day.
function mytDate(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function todayMyt(): string {
  return mytDate(new Date());
}

// Remaining amount on an unpaid invoice. amountPaid is the source of truth
// (covers deposits and ad-hoc partials); legacy DEPOSIT_PAID rows that predate
// the partial-payments migration fall back to depositAmount. Mirrors the
// weekly projection in cashflow.ts so both views show the same money.
export function remainingAmount(inv: {
  amount: number; amountPaid: number | null; depositAmount: number | null; status: string;
}): number {
  const amt = inv.amount;
  const paid = inv.amountPaid ?? 0;
  if (paid > 0) return Math.max(0, amt - paid);
  const dep = inv.depositAmount ?? 0;
  return inv.status === "DEPOSIT_PAID" ? Math.max(0, amt - dep) : amt;
}

// Expand a recurring expense's due dates into [from, to] (inclusive,
// YYYY-MM-DD). Walks nextDueDate forward by cadence, catching up when
// nextDueDate is already in the past.
export function expandOccurrences(
  exp: { nextDueDate: Date; cadence: "MONTHLY" | "QUARTERLY" | "YEARLY" },
  from: string,
  to: string,
): string[] {
  const months = exp.cadence === "MONTHLY" ? 1 : exp.cadence === "QUARTERLY" ? 3 : 12;
  const out: string[] = [];
  const cursor = new Date(exp.nextDueDate.getTime() + 8 * 3600_000); // MYT frame
  // Bound the catch-up so a badly stale row can't loop forever.
  for (let i = 0; i < 600 && cursor.toISOString().slice(0, 10) < from; i++) {
    cursor.setUTCMonth(cursor.getUTCMonth() + months);
  }
  while (cursor.toISOString().slice(0, 10) <= to) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + months);
  }
  return out;
}

const INVOICE_CATEGORY: Record<string, PayableCategory> = {
  INGREDIENT: "ingredients",
  ASSET: "asset",
  MAINTENANCE: "maintenance",
  OTHER: "other",
};

const RECURRING_CATEGORY: Record<string, PayableCategory> = {
  RENT: "rent",
  UTILITY: "utilities",
  SAAS: "software",
  PAYROLL_SUPPORT: "payroll",
  OTHER: "other",
};

// Pure aggregation — group window items per due day with a category split.
// Exported for unit tests.
export function bucketPayables(items: PayableItem[]): PayablesForecast["byDate"] {
  const map = new Map<string, { total: number; count: number; byCategory: Partial<Record<PayableCategory, number>> }>();
  for (const it of items) {
    if (!it.dueDate) continue;
    const e = map.get(it.dueDate) ?? { total: 0, count: 0, byCategory: {} };
    e.total = round2(e.total + it.amount);
    e.count += 1;
    e.byCategory[it.category] = round2((e.byCategory[it.category] ?? 0) + it.amount);
    map.set(it.dueDate, e);
  }
  return [...map.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function buildPayablesForecast(from: string, to: string): Promise<PayablesForecast> {
  const today = todayMyt();

  // The full unpaid set is small (~100 rows) — fetch it all and partition in
  // JS, so overdue/undated handling never depends on SQL date-boundary edge
  // cases across timezones.
  const invoices = await prisma.invoice.findMany({
    where: { status: { in: ["DRAFT", "PENDING", "INITIATED", "PARTIALLY_PAID", "DEPOSIT_PAID", "OVERDUE"] } },
    select: {
      id: true, invoiceNumber: true, amount: true, amountPaid: true, depositAmount: true,
      status: true, dueDate: true, outletId: true, expenseCategory: true,
      vendorName: true, supplier: { select: { name: true } },
    },
  });

  const recurring = await prisma.recurringExpense.findMany({
    where: { isActive: true },
    select: { id: true, name: true, category: true, amount: true, cadence: true, nextDueDate: true, outletId: true },
  });

  const windowItems: PayableItem[] = [];
  const overdueItems: PayableItem[] = [];

  for (const inv of invoices) {
    const amount = round2(remainingAmount({
      amount: Number(inv.amount),
      amountPaid: inv.amountPaid == null ? null : Number(inv.amountPaid),
      depositAmount: inv.depositAmount == null ? null : Number(inv.depositAmount),
      status: inv.status,
    }));
    if (amount <= 0) continue;
    const due = inv.dueDate ? mytDate(inv.dueDate) : null;
    const overdue = due == null || due < today;
    const item: PayableItem = {
      id: inv.id,
      source: "invoice",
      dueDate: due,
      payee: inv.supplier?.name ?? inv.vendorName ?? "Unknown payee",
      ref: inv.invoiceNumber || null,
      category: INVOICE_CATEGORY[inv.expenseCategory] ?? "other",
      outletId: inv.outletId,
      amount,
      status: inv.status,
      overdue,
    };
    if (overdue) overdueItems.push(item);
    else if (due != null && due >= from && due <= to) windowItems.push(item);
  }

  for (const exp of recurring) {
    const amount = round2(Number(exp.amount));
    if (amount <= 0) continue;
    for (const due of expandOccurrences({ nextDueDate: exp.nextDueDate, cadence: exp.cadence }, from, to)) {
      windowItems.push({
        id: `${exp.id}:${due}`,
        source: "recurring",
        dueDate: due,
        payee: exp.name,
        ref: null,
        category: RECURRING_CATEGORY[exp.category] ?? "other",
        outletId: exp.outletId,
        amount,
        status: "scheduled",
        overdue: false,
      });
    }
  }

  windowItems.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : b.amount - a.amount));
  // Oldest debt first; undated rows (no due date on record) at the end.
  overdueItems.sort((a, b) => {
    if (a.dueDate == null && b.dueDate == null) return b.amount - a.amount;
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    return a.dueDate.localeCompare(b.dueDate) || b.amount - a.amount;
  });

  const byDate = bucketPayables(windowItems);
  const catMap = new Map<PayableCategory, number>();
  for (const it of windowItems) catMap.set(it.category, round2((catMap.get(it.category) ?? 0) + it.amount));
  const byCategory = [...catMap.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);

  const invoiceTotal = round2(windowItems.filter((i) => i.source === "invoice").reduce((s, i) => s + i.amount, 0));
  const recurringTotal = round2(windowItems.filter((i) => i.source === "recurring").reduce((s, i) => s + i.amount, 0));

  return {
    from, to,
    items: windowItems,
    overdue: {
      total: round2(overdueItems.reduce((s, i) => s + i.amount, 0)),
      count: overdueItems.length,
      items: overdueItems,
    },
    byDate,
    byCategory,
    total: round2(invoiceTotal + recurringTotal),
    invoiceTotal,
    recurringTotal,
  };
}
