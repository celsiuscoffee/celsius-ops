// Aged Payables — outstanding supplier bills bucketed by how overdue they are
// (Current / 1-30 / 31-60 / 61-90 / 90+), per vendor. The AP report Bukku has
// and we lacked. Reads the procurement Invoice table directly, so it works now
// (independent of the GL). Aged Receivables has no real source here — the
// business settles sales same-day via card/QR/grab debtors, so there is no open
// customer-invoice ledger to age.

import { prisma } from "@/lib/prisma";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Bucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
export type AgedVendorRow = {
  vendor: string;
  count: number;
  current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number;
  total: number;
};
export type AgedPayables = {
  asOf: string;
  rows: AgedVendorRow[];
  totals: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  grandTotal: number;
  invoiceCount: number;
};

function bucketFor(daysOverdue: number): Bucket {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

export async function buildAgedPayables(input: { asOf: string }): Promise<AgedPayables> {
  const asOfDate = new Date(`${input.asOf}T23:59:59Z`);
  const invoices = await prisma.invoice.findMany({
    where: { status: { notIn: ["PAID", "DRAFT"] } },
    select: {
      amount: true, amountPaid: true, dueDate: true, issueDate: true,
      vendorName: true, supplier: { select: { name: true } },
    },
  });

  const byVendor = new Map<string, AgedVendorRow>();
  const totals = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let grandTotal = 0, invoiceCount = 0;

  for (const inv of invoices) {
    const outstanding = round2(Number(inv.amount) - Number(inv.amountPaid ?? 0));
    if (outstanding <= 0.005) continue;
    const vendor = inv.supplier?.name ?? inv.vendorName ?? "(no vendor)";
    const due = inv.dueDate ?? inv.issueDate;
    const daysOverdue = due ? Math.floor((asOfDate.getTime() - new Date(due).getTime()) / 86_400_000) : 0;
    const bucket = bucketFor(daysOverdue);

    const r = byVendor.get(vendor) ?? { vendor, count: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
    r[bucket] = round2(r[bucket] + outstanding);
    r.total = round2(r.total + outstanding);
    r.count++;
    byVendor.set(vendor, r);

    totals[bucket] = round2(totals[bucket] + outstanding);
    grandTotal = round2(grandTotal + outstanding);
    invoiceCount++;
  }

  const rows = [...byVendor.values()].sort((a, b) => b.total - a.total);
  return { asOf: input.asOf, rows, totals, grandTotal, invoiceCount };
}
