import { prisma } from "@/lib/prisma";
import type { CashCategory, BankLineDirection } from "@celsius/db";

// Cash-tracking matrix builder. Aggregates BankStatementLine rows by
// (category, outletId, YYYY-MM) so the cash-tracking page can render
// the per-outlet × category × month grid that mirrors Finance's
// existing spreadsheet framework.
//
// Outlet attribution rules:
//   - If a line has outletId set (from the classifier's inferOutlet
//     hint or from a manual edit), it belongs to that outlet.
//   - Otherwise it falls into a synthetic "HQ" bucket — payments paid
//     centrally from the HQ account that aren't tagged to a specific
//     outlet. The user has flagged that statutory/etc. paid by HQ on
//     behalf of outlets should eventually be re-allocated; for v1 we
//     keep them in HQ and let Finance re-tag inline.

export type CashCellKey = `${CashCategory}|${string}|${string}`; // category|outletId|YYYY-MM

export type CashTrackingMatrix = {
  // Outlets present (resolved from the union of line.outletId values
  // plus an "HQ" pseudo-outlet for unattributed lines).
  outlets: Array<{ id: string; code: string; name: string; isHQ: boolean }>;
  months: string[];                // YYYY-MM, ascending
  // For each (category, outletId, month) → net amount with sign:
  //   inflows positive, outflows negative.
  cells: Record<CashCellKey, number>;
  // Per-month totals across all outlets (also signed).
  monthTotals: Record<string, number>;
  // Per-month totals broken out by category (for the bottom summary band).
  categoryMonthTotals: Record<string, Record<string, number>>; // category → month → amount
  // Categories actually present in the data, in spreadsheet display order.
  categories: CashCategory[];
};

// Display order matches the spreadsheet framework Finance uses — inflow
// channels first, then COGS, labor, marketing, ops, compliance, capex,
// InterCo, catch-alls.
const CATEGORY_ORDER: CashCategory[] = [
  // Inflow
  "CARD" as CashCategory,
  "QR" as CashCategory,
  "STOREHUB" as CashCategory,
  "GRAB" as CashCategory,
  "GRAB_PUTRAJAYA" as CashCategory,
  "FOODPANDA" as CashCategory,
  "MEETINGS_EVENTS" as CashCategory,
  "GASTROHUB" as CashCategory,
  "CAPITAL" as CashCategory,
  "MANAGEMENT_FEE" as CashCategory,
  "ADTD" as CashCategory,
  "OTHER_INFLOW" as CashCategory,
  // Outflow — COGS
  "RAW_MATERIALS" as CashCategory,
  "DELIVERY" as CashCategory,
  // Outflow — Labor
  "DIRECTORS_ALLOWANCE" as CashCategory,
  "EMPLOYEE_SALARY" as CashCategory,
  "PARTIMER" as CashCategory,
  "STATUTORY_PAYMENT" as CashCategory,
  "STAFF_CLAIM" as CashCategory,
  "PETTY_CASH" as CashCategory,
  // Outflow — Marketing
  "MARKETPLACE_FEE" as CashCategory,
  "DIGITAL_ADS" as CashCategory,
  "KOL" as CashCategory,
  "OTHER_MARKETING" as CashCategory,
  // Outflow — Ops
  "RENT" as CashCategory,
  "UTILITIES" as CashCategory,
  "SOFTWARE" as CashCategory,
  // Outflow — Compliance / Finance
  "CFS_FEE" as CashCategory,
  "COMPLIANCE" as CashCategory,
  "TAX" as CashCategory,
  "LICENSING_FEE" as CashCategory,
  "ROYALTY_FEE" as CashCategory,
  "LOAN" as CashCategory,
  "BANK_FEE" as CashCategory,
  // Outflow — Capex
  "EQUIPMENTS" as CashCategory,
  "MAINTENANCE" as CashCategory,
  "INVESTMENTS" as CashCategory,
  // InterCo
  "INTERCO_PEOPLE" as CashCategory,
  "INTERCO_RAW_MATERIAL" as CashCategory,
  "INTERCO_INVESTMENTS" as CashCategory,
  "INTERCO_EXPENSES" as CashCategory,
  // Catch-alls
  "TRANSFER_NOT_SUCCESSFUL" as CashCategory,
  "OTHER_OUTFLOW" as CashCategory,
];

const HQ_PSEUDO_OUTLET_ID = "__HQ__";

export async function loadCashTrackingMatrix(opts: {
  // Months back from current; default 6.
  monthsBack?: number;
  outletIds?: string[];      // empty = all outlets including HQ pseudo
  includeInterCo?: boolean;  // default true; set false to net out internal transfers
}): Promise<CashTrackingMatrix> {
  const monthsBack = Math.max(1, Math.min(24, opts.monthsBack ?? 6));
  const outletIds = opts.outletIds ?? [];
  const includeInterCo = opts.includeInterCo ?? true;

  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  since.setMonth(since.getMonth() - (monthsBack - 1));

  // Fetch all lines in the window. Outlet filter applied here only for
  // tagged lines; "HQ" pseudo bucket is only included when the caller
  // didn't filter (empty array) or explicitly listed it.
  const lines = await prisma.bankStatementLine.findMany({
    where: {
      txnDate: { gte: since },
      ...(includeInterCo ? {} : { isInterCo: false }),
    },
    select: {
      txnDate: true,
      direction: true,
      amount: true,
      category: true,
      outletId: true,
      isInterCo: true,
    },
  });

  // Resolve outlets (including HQ pseudo). Outlet uses status enum, not
  // an isActive boolean — only ACTIVE outlets show up.
  const outletRecords = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  const outletIdSet = new Set(outletRecords.map((o) => o.id));

  // Bucketing
  const cells: Record<CashCellKey, number> = {};
  const monthSet = new Set<string>();
  const categorySet = new Set<CashCategory>();
  const monthTotals: Record<string, number> = {};
  const categoryMonthTotals: Record<string, Record<string, number>> = {};
  const usedOutletIds = new Set<string>();

  for (const l of lines) {
    if (!l.category) continue;            // unclassified — skipped from grid for now
    const month = ymd(l.txnDate).slice(0, 7);
    const oid = l.outletId && outletIdSet.has(l.outletId) ? l.outletId : HQ_PSEUDO_OUTLET_ID;

    // Outlet filter (HQ pseudo always included when no filter)
    if (outletIds.length > 0 && !outletIds.includes(oid)) continue;

    const signed = (l.direction as BankLineDirection) === "CR" ? Number(l.amount) : -Number(l.amount);
    const key: CashCellKey = `${l.category}|${oid}|${month}`;
    cells[key] = (cells[key] ?? 0) + signed;
    monthSet.add(month);
    categorySet.add(l.category);
    usedOutletIds.add(oid);
    monthTotals[month] = (monthTotals[month] ?? 0) + signed;
    if (!categoryMonthTotals[l.category]) categoryMonthTotals[l.category] = {};
    categoryMonthTotals[l.category][month] = (categoryMonthTotals[l.category][month] ?? 0) + signed;
  }

  // Build outlet list — only those with data, plus HQ pseudo if used.
  const outlets: CashTrackingMatrix["outlets"] = [];
  for (const o of outletRecords) {
    if (usedOutletIds.has(o.id)) outlets.push({ id: o.id, code: o.code, name: o.name, isHQ: false });
  }
  if (usedOutletIds.has(HQ_PSEUDO_OUTLET_ID)) {
    outlets.push({ id: HQ_PSEUDO_OUTLET_ID, code: "HQ", name: "HQ / unallocated", isHQ: true });
  }

  // Months ascending
  const months = Array.from(monthSet).sort();

  // Categories in display order, filtered to those with data
  const categories = CATEGORY_ORDER.filter((c) => categorySet.has(c));

  // Round all values to 2dp
  for (const k of Object.keys(cells)) cells[k as CashCellKey] = round2(cells[k as CashCellKey]);
  for (const k of Object.keys(monthTotals)) monthTotals[k] = round2(monthTotals[k]);
  for (const c of Object.keys(categoryMonthTotals)) {
    for (const m of Object.keys(categoryMonthTotals[c])) {
      categoryMonthTotals[c][m] = round2(categoryMonthTotals[c][m]);
    }
  }

  return { outlets, months, cells, monthTotals, categoryMonthTotals, categories };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const HQ_OUTLET_ID = HQ_PSEUDO_OUTLET_ID;
