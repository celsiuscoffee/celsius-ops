// "Sourced" P&L — a management P&L that pulls each section from its
// authoritative operational module instead of the (still-sparse) double-entry
// ledger, so the report reflects reality today:
//
//   Income     ← sales (AR EOD net sales, incl. drafts)        net of SST
//   COGS       ← procurement (supplier Invoices in period)     purchases proxy
//   Marketing  ← ads module (Google Ads) + bank non-digital marketing
//   Other opex ← classified bank-statement outflows by category
//
// Inter-company transfers, financing (loans/capital), and capex are excluded.
// COGS (raw materials) and digital ads are taken from procurement/ads, so the
// matching bank categories are excluded to avoid double-counting.
//
// Returns the same PnlReport shape as the ledger buildPnl() so the reports page
// renders it unchanged. The strict ledger buildPnl() stays in pnl.ts and still
// powers the auditor pack + period close.

import { getFinanceClient } from "../supabase";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getDefaultCompanyId } from "../companies";
import { depreciationTotal } from "../fixed-assets";
import type { PnlReport, PnlLine } from "./pnl";
import { getUnifiedSalesForOutlet } from "@/app/api/sales/_lib/unified-sales";
import { buildByCategory, type OutletPick } from "@/app/api/sales/_lib/reports";
import {
  peopleCostForScope,
  PEOPLE_SALARY_CODE,
  PEOPLE_STAT_CODE,
  PEOPLE_SALARY_NAME,
  PEOPLE_STAT_NAME,
  PEOPLE_UNASSIGNED_SALARY_NAME,
  PEOPLE_UNASSIGNED_STAT_NAME,
} from "./people-cost";

const round2 = (n: number) => Math.round(n * 100) / 100;

// The 3 Maybank current accounts, keyed by the company that owns them. The
// 4-digit suffix is embedded in BankStatement.accountName.
const BANK_ACCOUNT_SUFFIX: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

// Bank CashCategory → P&L treatment.
const BANK_COGS = new Set(["RAW_MATERIALS", "DELIVERY", "INTERCO_RAW_MATERIAL"]); // COGS comes from procurement
const BANK_DIGITAL_ADS = new Set(["DIGITAL_ADS"]);                                // = ads module (dedup)
const BANK_MARKETING = new Set(["MARKETPLACE_FEE", "KOL", "OTHER_MARKETING"]);     // non-digital marketing
// Salary + employer statutory now come from the HR payroll module on an accrual
// basis (see people-cost.ts), so their bank outflows are the cash settlement
// only and must NOT feed the P&L expense, so dropping them here avoids double
// counting the people cost. The bank lines still exist for the cash ledger,
// recon and GL. PARTIMER is intentionally NOT here: it stays outlet-tagged cash.
const BANK_PEOPLE_ACCRUED = new Set(["EMPLOYEE_SALARY", "STATUTORY_PAYMENT"]);
const BANK_NONOPEX = new Set([                                                    // internal / financing / capex / distributions — not operating
  "CAPITAL", "LOAN", "INTERCO_PEOPLE", "INTERCO_INVESTMENTS",
  "INTERCO_EXPENSES", "INVESTMENTS", "EQUIPMENTS", "ADTD", "TRANSFER_NOT_SUCCESSFUL",
  "DIVIDEND", "DIRECTORS_ALLOWANCE",  // shareholder/owner distributions, not P&L opex
]);
// NOTE: MANAGEMENT_FEE is deliberately NOT excluded — the fee a location pays HQ
// is a real operating expense in that entity's standalone P&L (books to 6511-06
// Management fees). It is still flagged isInterCo on the bank line, so the
// CONSOLIDATED P&L (which runs with excludeInterCo) drops it and the group
// figure isn't inflated by an internal charge.
// Catch-all + unclassified bank outflows. Surfaced as a flagged "needs review"
// line rather than buried in opex, because it double-counts COGS (unnamed
// supplier payments already in procurement) + internal transfers until the AP
// auto-match re-tags them. Visible so it can't silently inflate the P&L.
const BANK_REVIEW = new Set(["OTHER_OUTFLOW"]);

// ─── Expense-month accrual: the category shift map ──────────────────────────
// "A payment in month N belongs to month N + shift." The P&L recognises a
// shifted category's expense for [start, end] from the payments dated in
// [start - shift, end - shift] (for shift -1 that is the following month),
// the same window arithmetic the bespoke management-fee block used before it
// was generalised here. A per-line expenseMonth override (set from the recon
// page or the P&L drill) always outranks this map, and an AP-matched opex
// line outranks it with its invoice issue month. Cash Flow, the cashflow
// projections and the bank recon tie stay strictly cash-dated.
export const EXPENSE_MONTH_SHIFT: Record<string, number> = {
  MANAGEMENT_FEE: -1,   // HQ bills one month in arrears (owner-confirmed accrual)
};
// Only the management fee is auto-shifted. Salary, statutory (EPF/SOCSO/EIS/PCB)
// and utilities are paid slightly in arrears too, but auto-shifting them made
// the latest month you view look empty until the NEXT month's payment landed
// (June statutory needed July's payment), which read as missing spend. They now
// recognise on the payment date, so a month always shows what was actually paid
// in it. To book a specific payment to a different month, set the per-line
// expenseMonth override on the recon page or the P&L drill; it outranks this
// map. PARTIMER stays cash basis until matched to HR payroll runs; RENT is
// paid in-month for the month.

// P&L line-name suffix for shift-recognised categories.
const ACCRUED_SUFFIX = " (accrued, paid the following month)";

// Categories that feed the P&L as their own opex line (not COGS, not
// non-operating, not the digital-ads dedup, not the flagged review pile).
// Only these keep an AP-matched bank line in opex, recognised at the matched
// invoice's issue month; AP-matched lines outside this set settle a
// procurement invoice already counted in COGS purchases and stay excluded.
function isOpexFeedCategory(cat: string | null): boolean {
  if (!cat) return false;
  return !BANK_COGS.has(cat) && !BANK_NONOPEX.has(cat) && !BANK_DIGITAL_ADS.has(cat) && !BANK_REVIEW.has(cat) && !BANK_PEOPLE_ACCRUED.has(cat);
}

export type RecognisedBankLine = {
  id: string;
  txnDate: string;         // cash date, YYYY-MM-DD
  description: string;
  reference: string | null;
  amount: number;
  category: string | null;
  isInterCo: boolean;
  classifiedBy: string | null;
  ruleName: string | null;
  apInvoiceId: string | null;
  accountName: string | null;
  outletId: string | null;
  recognisedDate: string;  // the date the P&L recognises the line at
  recognisedMonth: string; // YYYY-MM of recognisedDate
  recognisedBy: "override" | "invoice" | "shift" | "cash";
  hasOverride: boolean;
};

// Bank lines with their effective expense-month recognition applied, for a
// P&L period [start, end]. Shared by buildSourcedPnl and the drill so the
// drill total always ties to the line amount. Precedence per line:
//   expenseMonth override > matched invoice issue month (DR opex only)
//   > category shift map > cash month.
// Inclusion is by recognisedDate within [start, end]; the fetch window covers
// the following month (shift -1 pulls payments from there) plus any line
// whose override drags it into the period from further away.
export async function fetchRecognisedBankLines(args: {
  direction: "DR" | "CR";
  start: string;
  end: string;
  suffix?: string;          // company bank-account tail (per-company view)
  consolidated?: boolean;   // all accounts, inter-company legs dropped
  outletId?: string | null;
  excludeInterCo?: boolean;
}): Promise<RecognisedBankLine[]> {
  const { direction, start, end, suffix, consolidated, outletId, excludeInterCo } = args;
  if (!consolidated && !suffix) return [];
  const monthFirst = (s: string) => `${s.slice(0, 7)}-01`;
  const rows = await prisma.bankStatementLine.findMany({
    where: {
      direction,
      ...(consolidated ? { isInterCo: false } : { statement: { accountName: { contains: suffix ?? "" } } }),
      ...(outletId ? { outletId } : {}),
      ...(excludeInterCo ? { isInterCo: false } : {}),
      OR: [
        { txnDate: { gte: dStart(start), lte: dEnd(addMonths(end, 1)) } },
        { expenseMonth: { gte: dStart(monthFirst(start)), lte: dEnd(monthFirst(end)) } },
      ],
    },
    select: {
      id: true, txnDate: true, description: true, reference: true, amount: true,
      category: true, isInterCo: true, classifiedBy: true, ruleName: true,
      apInvoiceId: true, expenseMonth: true, outletId: true,
      statement: { select: { accountName: true } },
    },
    orderBy: { txnDate: "asc" },
  });

  // AP-matched DR lines: settled procurement invoices (COGS) drop out of opex
  // entirely; matched OPEX lines stay and recognise at the invoice issue
  // month. One batched lookup, no per-line queries.
  const kept = rows.filter((l) => {
    if (direction === "CR" || !l.apInvoiceId) return true;
    return isOpexFeedCategory((l.category as string | null) ?? null);
  });
  const invoiceIds = [...new Set(kept.filter((l) => direction === "DR" && l.apInvoiceId).map((l) => l.apInvoiceId as string))];
  const issueById = new Map<string, string>();
  if (invoiceIds.length) {
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: { id: true, issueDate: true },
    });
    for (const inv of invoices) issueById.set(inv.id, ymd(inv.issueDate));
  }

  const out: RecognisedBankLine[] = [];
  for (const l of kept) {
    const cat = (l.category as string | null) ?? null;
    const txn = ymd(l.txnDate);
    let recognisedDate = txn;
    let recognisedBy: RecognisedBankLine["recognisedBy"] = "cash";
    if (l.expenseMonth) {
      recognisedDate = ymd(l.expenseMonth);
      recognisedBy = "override";
    } else if (direction === "DR" && l.apInvoiceId && issueById.has(l.apInvoiceId)) {
      recognisedDate = issueById.get(l.apInvoiceId)!;
      recognisedBy = "invoice";
    } else if (cat && EXPENSE_MONTH_SHIFT[cat]) {
      recognisedDate = addMonths(txn, EXPENSE_MONTH_SHIFT[cat]);
      recognisedBy = "shift";
    }
    if (recognisedDate < start || recognisedDate > end) continue;
    out.push({
      id: l.id,
      txnDate: txn,
      description: l.description,
      reference: l.reference,
      amount: round2(Number(l.amount)),
      category: cat,
      isInterCo: l.isInterCo,
      classifiedBy: l.classifiedBy,
      ruleName: l.ruleName,
      apInvoiceId: l.apInvoiceId,
      accountName: l.statement?.accountName ?? null,
      outletId: l.outletId,
      recognisedDate,
      recognisedMonth: recognisedDate.slice(0, 7),
      recognisedBy,
      hasOverride: !!l.expenseMonth,
    });
  }
  out.sort((a, b) => a.recognisedDate.localeCompare(b.recognisedDate) || a.txnDate.localeCompare(b.txnDate));
  return out;
}

// GrabFood revenue is booked GROSS in income, but Grab deducts a commission
// (marketplace fee) at source before paying out — so it never appears in the
// bank feed and must be recognised as a cost here, else Grab margin is wildly
// overstated. Commission is the selling company's cost, so it attributes to
// whichever company booked the Grab revenue — independent of which bank
// account the net payout lands in.
//
// The RATE is derived from the reconciliation itself. Grab's payout nets off
// EVERYTHING at source — commission AND the marketing deductions (merchant-
// funded promos, GrabAds). The promos and ads are already booked as their own
// P&L lines (MKT-GRAB-PROMO / MKT-GRAB-ADS), so the COMMISSION portion must
// exclude them or the marketing spend double-counts:
//
//   commission(window) = gross − payouts − promos − ads
//   rate = commission ÷ gross
//
// pooled over a trailing window across all companies to smooth weekly payout
// timing. Payouts land under the GRAB category — plus GRAB_PUTRAJAYA,
// Conezion's payouts settling into the HQ account. Falls back to ~30% (Grab's
// nominal commission) when the window is too thin, and clamps to a sane band
// so one weird payout week can't swing the P&L.
const GRAB_RATE_FALLBACK = 0.3;
const GRAB_RATE_WINDOW_DAYS = 120;
const GRAB_RATE_MIN_GROSS = 20_000; // below this the window is too thin to trust

export type GrabRate = {
  rate: number;
  source: "recon" | "fallback";
  windowGross: number;
  windowPayouts: number;
  windowPromos: number;
  windowAds: number;
};

// Merchant-funded Grab marketing for a set of outlets in a period: promos
// netted per completed order + manually entered GrabAds spend. Shared by the
// P&L builder and the commission drill so both use identical figures.
export async function grabMarketingForOutlets(
  outletIds: string[],
  start: string,
  end: string,
): Promise<{ promos: number; ads: number; loyaltyIds: string[] }> {
  if (!outletIds.length) return { promos: 0, ads: 0, loyaltyIds: [] };
  const loyaltyRows = await prisma.$queryRaw<{ loyalty_id: string }[]>(Prisma.sql`
    SELECT "loyaltyOutletId" AS loyalty_id FROM "Outlet"
    WHERE id IN (${Prisma.join(outletIds)}) AND "loyaltyOutletId" IS NOT NULL
  `);
  const loyaltyIds = loyaltyRows.map((r) => r.loyalty_id);
  if (!loyaltyIds.length) return { promos: 0, ads: 0, loyaltyIds };
  const [promoAgg, adAgg] = await Promise.all([
    prisma.$queryRaw<{ promo_sen: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(grab_merchant_promo), 0) AS promo_sen
      FROM pos_orders
      WHERE source = 'grabfood' AND status = 'completed'
        AND outlet_id IN (${Prisma.join(loyaltyIds)})
        AND created_at::date BETWEEN ${start}::date AND ${end}::date
    `),
    prisma.$queryRaw<{ ad_sen: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(amount_sen), 0) AS ad_sen
      FROM grab_ads_spend
      WHERE outlet_id IN (${Prisma.join(loyaltyIds)})
        AND period_start BETWEEN ${start}::date AND ${end}::date
    `),
  ]);
  return {
    promos: round2(Number(promoAgg[0]?.promo_sen ?? 0) / 100),
    ads: round2(Number(adAgg[0]?.ad_sen ?? 0) / 100),
    loyaltyIds,
  };
}

// Bank Grab payouts (GPAY settlements) received into the given accounts in the
// period.
async function grabPayoutsBanked(suffixes: string[], start: string, end: string): Promise<number> {
  const agg = await prisma.bankStatementLine.aggregate({
    _sum: { amount: true },
    where: {
      direction: "CR",
      category: { in: ["GRAB", "GRAB_PUTRAJAYA"] },
      txnDate: { gte: dStart(start), lte: dEnd(end) },
      statement: { OR: suffixes.map((x) => ({ accountName: { contains: `(${x})` } })) },
    },
  });
  return round2(Number(agg._sum?.amount ?? 0));
}

export type GrabCommissionRecon = {
  commission: number;   // the P&L line: gross − payouts − promos − ads, floored at 0
  gross: number;        // scope Grab gross for the period
  payouts: number;      // bank payouts attributed to the scope
  promos: number;       // merchant-funded promos (own P&L line)
  ads: number;          // GrabAds (own P&L line)
  poolShare: number;    // share of the pooled HQ account allocated (1 = exact bank)
  source: "bank_recon" | "rate_fallback";
  rate: number;         // implied effective commission %, for the line label
};

// Period-ACTUAL Grab commission: reconciled against the bank statement for the
// same period, never a capped trailing-window rate. The balance of gross less
// what Grab actually paid out is commission + Grab marketing; separately
// captured promos and GrabAds stay on their own lines, and the remainder is
// commission plus any marketing Grab netted off that we could not capture
// per order (the line name says so).
// Tamarind settles into its own account (exact). Shah Alam/Nilai and Conezion
// settle into the pooled HQ account as anonymous GPAY credits, so the pool is
// allocated by each company's booked Grab gross (GL 1005 EOD accruals). Falls
// back to the trailing-window rate only when the period has no settlements
// yet (an in-progress month) or for outlet-scoped views (no bank tie exists
// below company grain).
export async function grabCommissionRecon(args: {
  companyId: string;
  start: string;
  end: string;
  grabGross: number;
  promos: number;
  ads: number;
  outletScoped: boolean;
}): Promise<GrabCommissionRecon> {
  const { companyId, start, end, grabGross, promos, ads, outletScoped } = args;
  const mk = (commission: number, payouts: number, poolShare: number, source: GrabCommissionRecon["source"]): GrabCommissionRecon => {
    const c = round2(Math.max(0, commission));
    return {
      commission: c, gross: grabGross, payouts, promos, ads, poolShare, source,
      rate: grabGross > 0 ? Math.round((c / grabGross) * 1000) / 10 : 0,
    };
  };
  const fallback = async () => {
    const gr = await effectiveGrabRate(end);
    return mk(grabGross * gr.rate, 0, 0, "rate_fallback");
  };
  if (outletScoped) return fallback();

  if (companyId === "celsiustamarind") {
    const payouts = await grabPayoutsBanked(["9345"], start, end);
    if (payouts <= 0) return fallback();
    return mk(grabGross - payouts - promos - ads, payouts, 1, "bank_recon");
  }

  // celsius + celsiusconezion share the HQ pool (4384; 2644 included in case
  // Grab ever settles Conezion directly).
  const pool = await grabPayoutsBanked(["4384", "2644"], start, end);
  if (pool <= 0) return fallback();
  const glRows = await prisma.$queryRaw<{ company_id: string; g: number }[]>(Prisma.sql`
    SELECT t.company_id, COALESCE(SUM(l.debit), 0)::float AS g
    FROM fin_journal_lines l
    JOIN fin_transactions t ON t.id = l.transaction_id
    WHERE t.status = 'posted' AND t.txn_type <> 'grab_clearing' AND l.account_code = '1005'
      AND t.company_id IN ('celsius', 'celsiusconezion')
      AND t.txn_date >= ${start}::date AND t.txn_date <= ${end}::date
    GROUP BY 1
  `);
  const gCel = Number(glRows.find((r) => r.company_id === "celsius")?.g ?? 0);
  const gCon = Number(glRows.find((r) => r.company_id === "celsiusconezion")?.g ?? 0);
  const total = gCel + gCon;
  if (total <= 0) return fallback();
  const share = companyId === "celsius" ? gCel / total : gCon / total;
  const payouts = round2(pool * share);
  if (payouts <= 0) return fallback();
  return mk(grabGross - payouts - promos - ads, payouts, round2(share * 100) / 100, "bank_recon");
}

export async function effectiveGrabRate(end: string): Promise<GrabRate> {
  const winEnd = dEnd(end);
  const winStart = new Date(winEnd.getTime() - GRAB_RATE_WINDOW_DAYS * 86400_000);
  const fallback: GrabRate = { rate: GRAB_RATE_FALLBACK, source: "fallback", windowGross: 0, windowPayouts: 0, windowPromos: 0, windowAds: 0 };
  try {
    // Gross Grab sales in the window, pooled: StoreHub archive (pre-cutover
    // grab channel) + POS-native grabfood orders. Totals in RM / sen.
    const [sh, pn, pay, promo, ads] = await Promise.all([
      prisma.$queryRaw<{ t: number | null }[]>(Prisma.sql`
        SELECT COALESCE(SUM(total), 0)::float AS t FROM storehub_sales
        WHERE is_cancelled IS NOT TRUE AND channel ~* 'grab'
          AND transaction_time >= ${winStart} AND transaction_time <= ${winEnd}
      `),
      prisma.$queryRaw<{ t: number | null }[]>(Prisma.sql`
        SELECT COALESCE(SUM(total), 0)::float / 100 AS t FROM pos_orders
        WHERE source = 'grabfood' AND status = 'completed'
          AND created_at >= ${winStart} AND created_at <= ${winEnd}
      `),
      prisma.bankStatementLine.aggregate({
        _sum: { amount: true },
        where: {
          direction: "CR",
          category: { in: ["GRAB", "GRAB_PUTRAJAYA"] },
          txnDate: { gte: winStart, lte: winEnd },
        },
      }),
      // Marketing deductions Grab nets off the same payouts — booked as their
      // own P&L lines, so they must NOT be inside the commission rate.
      prisma.$queryRaw<{ t: number | null }[]>(Prisma.sql`
        SELECT COALESCE(SUM(grab_merchant_promo), 0)::float / 100 AS t FROM pos_orders
        WHERE source = 'grabfood' AND status = 'completed'
          AND created_at >= ${winStart} AND created_at <= ${winEnd}
      `),
      prisma.$queryRaw<{ t: number | null }[]>(Prisma.sql`
        SELECT COALESCE(SUM(amount_sen), 0)::float / 100 AS t FROM grab_ads_spend
        WHERE period_start >= ${winStart} AND period_start <= ${winEnd}
      `),
    ]);
    const gross = round2(Number(sh[0]?.t ?? 0) + Number(pn[0]?.t ?? 0));
    const payouts = round2(Number(pay._sum?.amount ?? 0));
    const promos = round2(Number(promo[0]?.t ?? 0));
    const adsSpend = round2(Number(ads[0]?.t ?? 0));
    if (gross < GRAB_RATE_MIN_GROSS || payouts <= 0) return fallback;
    const raw = (gross - payouts - promos - adsSpend) / gross;
    const rate = Math.min(0.5, Math.max(0.15, round2(raw)));
    return { rate, source: "recon", windowGross: gross, windowPayouts: payouts, windowPromos: promos, windowAds: adsSpend };
  } catch {
    return fallback;
  }
}

function humanCat(c: string | null): string {
  if (!c) return "Unclassified";
  return c.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
const dStart = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dEnd = (s: string) => new Date(`${s}T23:59:59.999Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Shift a YYYY-MM-DD date by n calendar months, clamping the day to the target
// month's length (Jan 31 + 1 month = Feb 28/29, not Mar 3).
function addMonths(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

// Cheapest active supplier cost per BASE unit, per stock product — the same
// basis the BOM/menu costing uses. Values physical stock counts for the COGS
// formula (Opening + Purchases − Closing).
// Two cost views, because a stock count line can be recorded in EITHER unit:
//  - byBase   : cheapest supplier cost per BASE unit (per g / ml / piece),
//               used when a count line has NO productPackageId (countedQty is
//               a base quantity like 86000 ml).
//  - byPackage: cheapest supplier price for a SPECIFIC package, used when the
//               line carries a productPackageId (countedQty is a package count
//               like 4 cartons). Valuing those against the per-base cost was
//               the bug: it divided every packaged line by its conversion
//               factor (24000x, 1000x) down to pennies, so whole counts read
//               RM40 and got rejected, forcing the purchases proxy.
type CostMaps = { byBase: Map<string, number>; byPackage: Map<string, number> };
async function costPerBaseUnit(): Promise<CostMaps> {
  const sps = await prisma.supplierProduct.findMany({
    where: { isActive: true, price: { gt: 0 } },
    select: { productId: true, productPackageId: true, price: true, productPackage: { select: { conversionFactor: true } }, supplier: { select: { supplierCode: true } } },
  });
  const byBase = new Map<string, number>();
  const byPackage = new Map<string, number>();
  for (const sp of sps) {
    if (sp.supplier?.supplierCode === "ADHOC") continue;
    const price = Number(sp.price);
    if (sp.productPackageId) {
      const ex = byPackage.get(sp.productPackageId);
      if (ex == null || price < ex) byPackage.set(sp.productPackageId, price);
    }
    const conv = Number(sp.productPackage?.conversionFactor ?? 0);
    if (conv <= 0) continue;
    const c = price / conv;
    const ex = byBase.get(sp.productId);
    if (ex == null || c < ex) byBase.set(sp.productId, c);
  }
  return { byBase, byPackage };
}

// A single bar's ingredient stock is a few hundred ringgit per line at most; a
// line worth more than this is a mis-keyed quantity (a base amount typed into
// a package line, or vice versa). One such line once inflated a whole count to
// RM10.9M, so a count carrying any is treated as broken and skipped.
const MAX_PLAUSIBLE_LINE = 8000;
// A full outlet bar count lands roughly here; outside the band the count is
// partial or broken, so fall back to the proxy rather than print a wrong COGS.
const MIN_PLAUSIBLE_TOTAL = 2000;
const MAX_PLAUSIBLE_TOTAL = 60000;

// Outlets often finalise a month-end count a few days into the next month
// (an end-of-May count dated 2 June), so match a count to a boundary within a
// window that reaches a little PAST it, not only before, and pick the count
// nearest the boundary. Wider back than forward: a slightly-late count is
// fine, a stale month-old one is not.
const COUNT_LOOKBACK_DAYS = 25;
const COUNT_LOOKAHEAD_DAYS = 12;
// A single fat-fingered line (a base amount typed into a package line) should
// not kill an otherwise good count, so lines above this are dropped as typos.
// But if too many lines are typos the whole count is untrustworthy, so reject
// it once the typo share crosses this fraction.
const MAX_TYPO_LINE_SHARE = 0.1;

// Evaluate one stock count: value each line in its recorded unit (package
// price when the line names a package, base cost otherwise), drop obvious
// per-line typos, and decide whether the cleaned count is a usable full
// inventory. Returns null when it is partial (too few real items), too
// corrupted (too many typo lines), or values outside the plausible band.
function evaluateCount(
  items: { productId: string; productPackageId: string | null; countedQty: unknown }[],
  cost: CostMaps,
): { value: number; items: number; costed: number; dropped: number } | null {
  const MIN_ITEMS = 100;
  let value = 0, counted = 0, costed = 0, dropped = 0;
  for (const it of items) {
    if (it.countedQty == null) continue;
    counted++;
    const u = it.productPackageId ? cost.byPackage.get(it.productPackageId) : cost.byBase.get(it.productId);
    if (u == null) continue;
    const lineValue = Number(it.countedQty) * u;
    if (lineValue > MAX_PLAUSIBLE_LINE) { dropped++; continue; } // fat-finger typo
    costed++; value += lineValue;
  }
  if (counted === 0) return null;
  if (dropped / counted > MAX_TYPO_LINE_SHARE) return null; // systematically mis-keyed
  const kept = counted - dropped;
  if (kept < MIN_ITEMS || value < MIN_PLAUSIBLE_TOTAL || value > MAX_PLAUSIBLE_TOTAL) return null;
  return { value: round2(value), items: kept, costed, dropped };
}

// Value inventory at a period boundary, PER OUTLET, from two candidate
// sources: the finalized (REVIEWED/SUBMITTED) stock count nearest the
// boundary, and any manual valuation in fin_inventory_valuations (external
// known-good figures, e.g. the Bukku Q1 closing inventory anchoring Q2's
// opening at the cutover). Per outlet the candidate CLOSEST to the boundary
// wins. Returns the per-outlet map so the caller can require the SAME outlet
// set at both boundaries — summing whatever outlets happened to have a
// valuation at each boundary would let one outlet's entire stock value appear
// on one side of the roll-forward and not the other, silently swinging COGS
// by that amount.
type BoundaryValuation = { date: Date; value: number; items: number; costed: number; dropped: number; gap: number; manual?: string };
async function valueInventoryAt(
  outletIds: string[],
  boundary: Date,
  cost: CostMaps,
): Promise<Map<string, BoundaryValuation>> {
  const used = new Map<string, BoundaryValuation>();
  if (!outletIds.length) return used;
  const since = new Date(boundary.getTime() - COUNT_LOOKBACK_DAYS * 86400_000);
  const until = new Date(boundary.getTime() + COUNT_LOOKAHEAD_DAYS * 86400_000);
  const counts = await prisma.stockCount.findMany({
    where: { outletId: { in: outletIds }, status: { in: ["REVIEWED", "SUBMITTED"] }, countDate: { gte: since, lte: until } },
    select: { outletId: true, countDate: true, items: { select: { productId: true, productPackageId: true, countedQty: true } } },
  });
  // Per outlet, the usable count CLOSEST to the boundary wins (a count on the
  // 2nd represents the 1st better than one from three weeks earlier).
  for (const c of counts) {
    const ok = evaluateCount(c.items, cost);
    if (!ok) continue;
    const gap = Math.abs(c.countDate.getTime() - boundary.getTime());
    const prev = used.get(c.outletId);
    if (!prev || gap < prev.gap) used.set(c.outletId, { date: c.countDate, ...ok, gap });
  }

  // Manual valuations compete on the same closest-to-boundary rule. Guarded:
  // the table is SQL-managed and may not exist yet in an environment — the
  // count-based path must never break because of it.
  try {
    const manual = await prisma.$queryRaw<{ outlet_id: string; as_of: Date; value: number; source: string }[]>(Prisma.sql`
      SELECT outlet_id, as_of, value::float AS value, source
      FROM fin_inventory_valuations
      WHERE outlet_id IN (${Prisma.join(outletIds)})
        AND as_of >= ${since}::date AND as_of <= ${until}::date
    `);
    for (const m of manual) {
      const gap = Math.abs(m.as_of.getTime() - boundary.getTime());
      const prev = used.get(m.outlet_id);
      if (!prev || gap < prev.gap) {
        used.set(m.outlet_id, { date: m.as_of, value: round2(Number(m.value)), items: 0, costed: 0, dropped: 0, gap, manual: m.source });
      }
    }
  } catch {
    // Table absent — counts-only behaviour.
  }
  return used;
}

// Sum a boundary valuation over a fixed outlet set (the outlets usable at
// BOTH boundaries) into the display shape the COGS lines carry.
function sumBoundary(
  map: Map<string, BoundaryValuation>,
  outlets: string[],
): { value: number; dates: string[]; coverage: string } {
  let value = 0, tot = 0, costed = 0, dropped = 0;
  const dates: string[] = [];
  const manualSources = new Set<string>();
  for (const o of outlets) {
    const u = map.get(o);
    if (!u) continue;
    value += u.value; tot += u.items; costed += u.costed; dropped += u.dropped; dates.push(ymd(u.date));
    if (u.manual) manualSources.add(u.manual);
  }
  let note = dropped ? `${costed}/${tot} items, ${dropped} typo dropped` : `${costed}/${tot} items`;
  if (manualSources.size) {
    const manualNote = `manual: ${[...manualSources].sort().join(", ")}`;
    note = tot > 0 ? `${note} + ${manualNote}` : manualNote;
  }
  return { value: round2(value), dates: [...new Set(dates)].sort(), coverage: note };
}

export async function buildSourcedPnl(input: {
  companyId: string;
  start: string;
  end: string;
  outletId?: string; // when set, scope to one outlet — revenue + COGS + the
                     // outlet-TAGGED bank costs only. Shared/HQ opex (paid from
                     // the entity account, untagged) can't be split per outlet,
                     // so a per-outlet view is a contribution margin, not net.
  excludeInterCo?: boolean; // consolidated mode: drop inter-company legs so
                            // group-internal transfers (salary funding, mgmt
                            // fees, stock transfers) eliminate instead of
                            // stacking as expense in every entity they pass.
}): Promise<PnlReport> {
  const { companyId, start, end, outletId, excludeInterCo } = input;
  const client = getFinanceClient();
  const defaultCompany = await getDefaultCompanyId();

  // Company's outlets (UUIDs) — drive both revenue and COGS. Narrow to one when
  // an outlet filter is set (and it belongs to the company).
  const { data: oc } = await client
    .from("fin_outlet_companies").select("outlet_id").eq("company_id", companyId);
  const companyOutletIds = (oc ?? []).map((r) => r.outlet_id as string);
  const outletIds = outletId && companyOutletIds.includes(outletId) ? [outletId] : companyOutletIds;

  // ─── INCOME: actual GROSS sales, cutover-aware (StoreHub history + POS-native
  // + pickup) — the SAME source the sales dashboard uses. Replaces the
  // under-posting AR-EOD ledger (which read ~RM250k vs ~RM345k actual). SST is
  // 0 so gross ≈ net. Split by channel: in-store / online / Grab / FoodPanda.
  const outletRows = outletIds.length
    ? await prisma.outlet.findMany({
        where: { id: { in: outletIds } },
        select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
      })
    : [];
  const rev = { instore: 0, online: 0, grab: 0, foodpanda: 0 };
  let saleCount = 0;
  // Any accrual-shifted line in the period adds a short note to the report.
  let shiftedPresent = false;
  // HR-sourced people cost present in the period adds its own accrual note.
  let peoplePresent = false;
  const perOutlet = await Promise.all(
    outletRows.map((o) =>
      getUnifiedSalesForOutlet(
        { outletId: o.id, storehubStoreId: null, loyaltyOutletId: o.loyaltyOutletId, pickupStoreId: o.pickupStoreId, cutoverAt: o.posNativeCutoverAt },
        dStart(start),
        dEnd(end),
      ),
    ),
  );
  for (const sales of perOutlet) {
    for (const s of sales) {
      saleCount++;
      const lbl = (s.channelLabel ?? "").toLowerCase();
      if (/grab/.test(lbl)) rev.grab += s.total;
      else if (/panda/.test(lbl)) rev.foodpanda += s.total;
      else if (s.isDeliveryQR || s.channel === "delivery") rev.online += s.total;
      else rev.instore += s.total;
    }
  }
  const grabGrossRevenue = round2(rev.grab); // gross Grab, for the commission line
  const incomeLines: PnlLine[] = [
    { code: "REV-INSTORE", name: "In-store sales (dine-in + takeaway)", amount: round2(rev.instore), parentCode: null },
    { code: "REV-ONLINE", name: "Online sales (pickup + table QR)", amount: round2(rev.online), parentCode: null },
    { code: "REV-GRAB", name: "GrabFood sales (gross)", amount: round2(rev.grab), parentCode: null },
    { code: "REV-PANDA", name: "FoodPanda sales", amount: round2(rev.foodpanda), parentCode: null },
  ].filter((l) => l.amount !== 0);
  let totalIncome = round2(rev.instore + rev.online + rev.grab + rev.foodpanda);

  // Non-POS revenue the sales sources can't see: GastroHub (Nilai's cloud-kitchen
  // channel) and Meetings/Events (IOI Mall) settle straight into the bank with no
  // POS order behind them, so income was understated by their whole amount.
  // Sourced from the classified bank inflows for this company's account.
  const incomeSuffix = BANK_ACCOUNT_SUFFIX[companyId];
  if (incomeSuffix) {
    const bankIncome = await prisma.bankStatementLine.groupBy({
      by: ["category"],
      where: {
        direction: "CR",
        txnDate: { gte: dStart(start), lte: dEnd(end) },
        statement: { accountName: { contains: incomeSuffix } },
        category: { in: ["GASTROHUB", "MEETINGS_EVENTS"] },
        ...(outletId ? { outletId } : {}),
        ...(excludeInterCo ? { isInterCo: false } : {}),
      },
      _sum: { amount: true },
    });
    for (const g of bankIncome) {
      const amt = round2(Number(g._sum?.amount ?? 0));
      if (!amt) continue;
      incomeLines.push(
        g.category === "GASTROHUB"
          ? { code: "REV-GASTRO", name: "GastroHub sales (Nilai)", amount: amt, parentCode: null }
          : { code: "REV-EVENTS", name: "Meetings and events sales", amount: amt, parentCode: null },
      );
      totalIncome = round2(totalIncome + amt);
    }

    // Management fee INCOME (HQ side): the fee the group outlets pay lands as
    // a MANAGEMENT_FEE inflow in this company's account. Bukku's books carried
    // these receipts on account 5007 Management fees, so they keep their own
    // revenue line here rather than folding into sales. Recognised with the
    // same one-month-arrears shift as the expense side, and the lines are
    // flagged isInterCo so the consolidated view (excludeInterCo) eliminates
    // them against the outlets' management-fee expense.
    const feeInflows = await fetchRecognisedBankLines({
      direction: "CR", start, end, suffix: incomeSuffix, outletId, excludeInterCo,
    });
    const mgmtFeeIncome = round2(
      feeInflows.filter((l) => l.category === "MANAGEMENT_FEE").reduce((s, l) => s + l.amount, 0),
    );
    if (mgmtFeeIncome) {
      incomeLines.push({ code: "REV-MGMT", name: "Management fees (from group outlets)", amount: mgmtFeeIncome, parentCode: null });
      totalIncome = round2(totalIncome + mgmtFeeIncome);
      shiftedPresent = true;
    }
  }

  // ─── COGS: Opening inventory + Purchases − Closing inventory ──────────────
  const invDate = { gte: dStart(start), lte: dEnd(end) };
  const invAgg = await prisma.invoice.aggregate({
    _sum: { amount: true },
    where: { issueDate: invDate, outletId: { in: outletIds.length ? outletIds : ["__none__"] } },
  });
  const purchases = round2(Number(invAgg._sum?.amount ?? 0));

  const costMap = await costPerBaseUnit();

  // Inter-outlet stock transfers. Stock is bought by one outlet (its invoices
  // carry the cost) and shipped to another, so without netting, the sender's
  // COGS is overstated by everything it forwarded and the receiver consumes
  // for free. Transfers crossing the scope boundary adjust purchases: sent
  // stock out (−), received stock in (+). Transfers wholly inside the scope
  // (outlet-to-outlet within one company view) cancel and are skipped. Valued
  // like everything else here: package price when the line names a package
  // (transfer quantities are PACKAGE units when productPackageId is set),
  // base cost otherwise. Timing follows the variance report: outbound by
  // createdAt, inbound by receivedAt.
  let transfersOut = 0;
  let transfersIn = 0;
  {
    const inScope = new Set(outletIds.length ? outletIds : ["__none__"]);
    const items = await prisma.stockTransferItem.findMany({
      where: {
        transfer: {
          status: { in: ["RECEIVED", "COMPLETED"] },
          OR: [
            { toOutletId: { in: [...inScope] }, receivedAt: invDate },
            { fromOutletId: { in: [...inScope] }, createdAt: invDate },
          ],
        },
      },
      select: {
        productId: true, productPackageId: true, quantity: true,
        transfer: { select: { fromOutletId: true, toOutletId: true } },
      },
    });
    for (const ti of items) {
      const fromIn = inScope.has(ti.transfer.fromOutletId);
      const toIn = inScope.has(ti.transfer.toOutletId);
      if (fromIn === toIn) continue; // internal to the scope — cancels
      const unit = ti.productPackageId ? costMap.byPackage.get(ti.productPackageId) : costMap.byBase.get(ti.productId);
      if (unit == null) continue;
      const v = Number(ti.quantity) * unit;
      if (fromIn) transfersOut += v;
      else transfersIn += v;
    }
    transfersOut = round2(transfersOut);
    transfersIn = round2(transfersIn);
  }
  const netPurchases = round2(purchases - transfersOut + transfersIn);
  const transferLines: PnlLine[] = [
    ...(transfersOut ? [{ code: "XFER-OUT", name: "Less: Stock transferred to other outlets (at supplier cost)", amount: -transfersOut, parentCode: null }] : []),
    ...(transfersIn ? [{ code: "XFER-IN", name: "Add: Stock received from other outlets (at supplier cost)", amount: transfersIn, parentCode: null }] : []),
  ];

  // True COGS = Opening inventory + Purchases − Closing inventory, valuing the
  // bounding stock counts at supplier cost. Only outlets with a usable count
  // at BOTH boundaries enter the roll-forward — an outlet counted at one
  // boundary only would put its whole stock value on one side and swing COGS
  // by that amount. Falls back to purchases-only when no outlet covers both
  // boundaries (so it's never a wrong number — just a flagged proxy).
  const [openMap, closeMap] = await Promise.all([
    valueInventoryAt(outletIds, dStart(start), costMap),
    valueInventoryAt(outletIds, dEnd(end), costMap),
  ]);
  const bothBounded = [...openMap.keys()].filter((o) => closeMap.has(o));
  let cogsTotal: number;
  let cogsLines: PnlLine[];
  // Purchases above theoretical consumption when no count bounds the period —
  // expensed below gross profit as STOCK-VAR (see the fallback branch).
  let stockVariance = 0;
  if (bothBounded.length > 0) {
    const opening = sumBoundary(openMap, bothBounded);
    const closing = sumBoundary(closeMap, bothBounded);
    // Outlets with no usable pair of counts contribute purchases only — say so
    // on the line instead of implying the roll-forward covered everything.
    const unbounded = outletIds.filter((o) => !bothBounded.includes(o)).length;
    const scopeNote = unbounded ? ` · ${bothBounded.length}/${outletIds.length} outlets counted, rest purchases-only` : "";
    cogsTotal = round2(opening.value + netPurchases - closing.value);
    cogsLines = [
      { code: "INV-OPEN", name: `Opening inventory (count ${opening.dates.join(", ")} · ${opening.coverage}${scopeNote})`, amount: opening.value, parentCode: null },
      { code: "PROC", name: "Add: Purchases (procurement)", amount: purchases, parentCode: null },
      ...transferLines,
      { code: "INV-CLOSE", name: `Less: Closing inventory (count ${closing.dates.join(", ")} · ${closing.coverage})`, amount: -closing.value, parentCode: null },
    ];
  } else {
    // No usable count pair. COGS is the THEORETICAL consumption (sales ×
    // recipes at supplier cost, the same engine as the COGS report and the
    // dashboard) so gross profit reflects real recipe economics. The
    // purchases-above-consumption remainder is unverifiable (stock build or
    // waste, only a closing count can tell which), so it is neither COGS nor
    // an asset: it lands below gross profit as its own expense line
    // (STOCK-VAR), still fully expensed, net income identical to expensing
    // the purchases directly. A stock DRAWDOWN (purchases below consumption)
    // stays inside COGS as split lines, since the extra consumption came out
    // of prior-period stock and belongs in cost of sales; charging more than
    // was purchased would double-expense what earlier periods already bore.
    cogsTotal = netPurchases;
    let theoretical = 0;
    if (netPurchases > 0 && outletRows.length) {
      try {
        const cat = await buildByCategory(outletRows as OutletPick[], start, end);
        theoretical = round2(Number(cat.total?.cogs) || 0);
      } catch {
        theoretical = 0; // theoretical engine unavailable — single-line fallback
      }
    }
    if (theoretical > 0 && netPurchases - theoretical >= 1) {
      stockVariance = round2(netPurchases - theoretical);
      cogsTotal = theoretical;
      cogsLines = [
        { code: "COGS-CONS", name: "Ingredient consumption (theoretical: sales × recipes at supplier cost)", amount: theoretical, parentCode: null },
      ];
    } else if (theoretical > 0 && theoretical - netPurchases >= 1) {
      cogsLines = [
        { code: "COGS-CONS", name: "Ingredient consumption (theoretical: sales × recipes at supplier cost)", amount: theoretical, parentCode: null },
        { code: "COGS-VAR", name: "Purchases below consumption (stock drawdown, no usable closing count)", amount: round2(netPurchases - theoretical), parentCode: null },
      ];
    } else {
      cogsLines = netPurchases || purchases
        ? [
            { code: "PROC", name: "Purchases (procurement, COGS = purchases, no usable stock count)", amount: purchases, parentCode: null },
            ...transferLines,
          ]
        : [];
    }
  }

  // ─── EXPENSES: marketing (ads + bank) + other opex (bank) ────────────────
  const expenseLines: PnlLine[] = [];
  let totalExpenses = 0;

  // Unverified inventory variance from the COGS fallback: not cost of goods
  // actually sold, not a provable asset, so it sits here, visible, fully
  // expensed, resolved to real inventory movement once counts exist.
  if (stockVariance > 0) {
    expenseLines.push({
      code: "STOCK-VAR",
      name: "Inventory variance: purchases above consumption (stock build or waste, pending closing count)",
      amount: stockVariance,
      parentCode: null,
    });
    totalExpenses += stockVariance;
  }

  // Marketing — Google Ads attributed PER OUTLET via the campaign's outletId
  // (set in the ads module). A campaign tagged to an outlet lands in that
  // outlet's / company's P&L; untagged brand-level campaigns stay with the
  // default company. Per-outlet view shows only that outlet's tagged spend.
  {
    const adsByOutlet = await prisma.$queryRaw<{ outlet_id: string | null; spend: number }[]>(Prisma.sql`
      SELECT c.outlet_id, COALESCE(SUM(m.cost_micros), 0)::float / 1e6 AS spend
      FROM ads_metric_daily m
      LEFT JOIN ads_campaign c ON c.id = m.campaign_id
      WHERE m.date >= ${dStart(start)} AND m.date <= ${dEnd(end)}
        AND m.campaign_id IS NOT NULL
      GROUP BY c.outlet_id
    `);
    let adsSpend = 0;
    for (const r of adsByOutlet) {
      const oid = r.outlet_id;
      if (oid && outletIds.includes(oid)) adsSpend += Number(r.spend);
      // Untagged brand-level spend → default company, company-level view only.
      else if (!oid && !outletId && companyId === defaultCompany) adsSpend += Number(r.spend);
    }
    adsSpend = round2(adsSpend);
    if (adsSpend) {
      expenseLines.push({ code: "MKT-ADS", name: "Digital ads (Google)", amount: adsSpend, parentCode: null });
      totalExpenses += adsSpend;
    }
  }

  // Marketing — GrabFood: merchant-funded promo cost (per completed order) +
  // manually entered GrabAds spend, for THIS company's outlets. GrabFood revenue
  // is booked GROSS in income (pos-native EOD sends the whole order total to the
  // grabfood channel without deducting the promo), so the merchant-funded promo
  // must be recognized as a cost here — it is NOT double-counted. grab_merchant_promo
  // is the merchant-funded part only (Grab-funded promo is Grab's cost, excluded).
  // fin_outlet_companies/invoices key outlets by the Outlet UUID, but
  // pos_orders/grab_ads_spend use the loyalty outlet id (e.g. "outlet-sa") —
  // bridge UUID → loyaltyOutletId before querying the Grab tables.
  let grabPromoTotal = 0;
  let grabAdsTotal = 0;
  if (outletIds.length) {
    const mkt = await grabMarketingForOutlets(outletIds, start, end);
    if (mkt.loyaltyIds.length) {
      const grabPromo = mkt.promos;
      grabPromoTotal = grabPromo;
      if (grabPromo) {
        expenseLines.push({ code: "MKT-GRAB-PROMO", name: "GrabFood promos (merchant-funded)", amount: grabPromo, parentCode: null });
        totalExpenses += grabPromo;
      }

      const grabAds = mkt.ads;
      grabAdsTotal = grabAds;
      if (grabAds) {
        expenseLines.push({ code: "MKT-GRAB-ADS", name: "GrabAds", amount: grabAds, parentCode: null });
        totalExpenses += grabAds;
      }
    }
  }

  // GrabFood commission (marketplace fee) — applied to the gross Grab revenue
  // booked above, since Grab nets it out before payout (never in the bank
  // feed). The rate comes from the payout reconciliation, not a hardcoded
  // guess — see effectiveGrabRate.
  if (grabGrossRevenue > 0) {
    const gc = await grabCommissionRecon({
      companyId, start, end,
      grabGross: grabGrossRevenue,
      promos: grabPromoTotal,
      ads: grabAdsTotal,
      outletScoped: !!outletId,
    });
    if (gc.commission > 0) {
      expenseLines.push({
        code: "MKT-GRAB-COMM",
        name: gc.source === "bank_recon"
          ? "GrabFood commission + marketing (bank-reconciled)"
          : "GrabFood commission + marketing (estimated, payouts not yet settled)",
        amount: gc.commission,
        parentCode: null,
      });
      totalExpenses += gc.commission;
    }
  }

  // Bank-classified outflows for this company's account, each line recognised
  // in its expense month (per-line override > matched invoice issue month >
  // category shift map > cash month). The shift map replaced the bespoke
  // management-fee accrual block; the window arithmetic is unchanged.
  const suffix = BANK_ACCOUNT_SUFFIX[companyId];
  if (suffix) {
    const opexLines = await fetchRecognisedBankLines({ direction: "DR", start, end, suffix, outletId, excludeInterCo });
    const byCat = new Map<string, number>();
    for (const l of opexLines) {
      const cat = l.category;
      if (cat && (BANK_COGS.has(cat) || BANK_NONOPEX.has(cat) || BANK_DIGITAL_ADS.has(cat) || BANK_PEOPLE_ACCRUED.has(cat))) continue;
      byCat.set(cat ?? "NULL", (byCat.get(cat ?? "NULL") ?? 0) + l.amount);
    }
    for (const [key, sum] of byCat) {
      const cat = key === "NULL" ? null : key;
      const amt = round2(sum);
      if (!amt) continue;
      const isReview = !cat || BANK_REVIEW.has(cat);
      const isMkt = !!cat && BANK_MARKETING.has(cat);
      const isShifted = !!cat && !!EXPENSE_MONTH_SHIFT[cat];
      if (isShifted) shiftedPresent = true;
      expenseLines.push({
        code: `BANK:${cat ?? "NULL"}`,
        name: isReview
          ? "Unclassified (pending AP match review)"
          : humanCat(cat) + (isMkt ? " (marketing)" : "") + (isShifted ? ACCRUED_SUFFIX : ""),
        amount: amt,
        parentCode: null,
      });
      totalExpenses += amt;
    }
  }

  // People cost: salary + employer statutory, ACCRUED from the HR payroll runs
  // for the period (people-cost.ts), replacing the bank EMPLOYEE_SALARY /
  // STATUTORY_PAYMENT outflows dropped above. The cost lands in the work month
  // of the run, independent of when the bank paid it, so the latest month is
  // always populated once its run exists. Per outlet uses each employee's
  // assigned outlet exactly; staff with no assigned outlet fall into a single
  // visible unassigned line (default company + consolidated only).
  {
    const pc = await peopleCostForScope({
      companyId,
      defaultCompanyId: defaultCompany,
      start,
      end,
      outletIds,
      outletScoped: !!outletId,
      consolidated: !!excludeInterCo,
    });
    if (pc.salary) {
      expenseLines.push({ code: PEOPLE_SALARY_CODE, name: PEOPLE_SALARY_NAME, amount: pc.salary, parentCode: null });
      totalExpenses += pc.salary;
    }
    if (pc.statutory) {
      expenseLines.push({ code: PEOPLE_STAT_CODE, name: PEOPLE_STAT_NAME, amount: pc.statutory, parentCode: null });
      totalExpenses += pc.statutory;
    }
    if (pc.unassignedSalary) {
      expenseLines.push({ code: `${PEOPLE_SALARY_CODE}-UNASSIGNED`, name: PEOPLE_UNASSIGNED_SALARY_NAME, amount: pc.unassignedSalary, parentCode: null });
      totalExpenses += pc.unassignedSalary;
    }
    if (pc.unassignedStatutory) {
      expenseLines.push({ code: `${PEOPLE_STAT_CODE}-UNASSIGNED`, name: PEOPLE_UNASSIGNED_STAT_NAME, amount: pc.unassignedStatutory, parentCode: null });
      totalExpenses += pc.unassignedStatutory;
    }
    if (pc.salary || pc.statutory || pc.unassignedSalary || pc.unassignedStatutory) {
      peoplePresent = true;
    }
  }

  // Depreciation: straight-line from the fixed-asset register (source-driven,
  // no journal dependency). Equipment purchases NEVER hit this P&L as an
  // expense (EQUIPMENTS sits in BANK_NONOPEX above), so recognising the
  // depreciation charge here is the whole cost story, with no double count
  // whether or not a purchase line has been capitalized into an asset yet.
  // Month convention (documented in lib/finance/fixed-assets.ts): charges
  // start the first full month after acquisition, are dated on each month's
  // last day (so a window includes a month iff its last day is inside), and
  // stop from the disposal month onward.
  {
    const dep = await depreciationTotal({ companyId, start, end, outletId });
    if (dep) {
      expenseLines.push({ code: "DEP", name: "Depreciation (fixed assets, straight-line)", amount: dep, parentCode: null });
      totalExpenses += dep;
    }
  }
  totalExpenses = round2(totalExpenses);
  expenseLines.sort((a, b) => b.amount - a.amount);

  const grossProfit = round2(totalIncome - cogsTotal);
  const netIncome = round2(grossProfit - totalExpenses);

  return {
    companyId,
    start,
    end,
    income: { type: "income", total: totalIncome, lines: incomeLines },
    cogs: { type: "cogs", total: cogsTotal, lines: cogsLines },
    grossProfit,
    expenses: { type: "expense", total: totalExpenses, lines: expenseLines },
    netIncome,
    txnCount: saleCount,
    // Boundary honesty: with a one-month-arrears shift, the newest month of a
    // report only fills once the following month's payments are recorded. The
    // people-cost note flags the HR-accrual semantics separately.
    ...((shiftedPresent || peoplePresent)
      ? { notes: [...(shiftedPresent ? [ACCRUAL_NOTE] : []), ...(peoplePresent ? [PEOPLE_ACCRUAL_NOTE] : [])] }
      : {}),
  };
}

// Shown under the P&L whenever an HR-sourced people-cost line is present.
const PEOPLE_ACCRUAL_NOTE =
  "Salary and statutory are accrued from the HR payroll runs for the period, so they land in the month worked, not when paid. Per outlet uses each employee's assigned outlet. A month shows people cost once its payroll run exists.";

// Shown under the P&L whenever a shift-recognised line is present.
const ACCRUAL_NOTE =
  "Accrued lines are shown in the month the cost belongs to, not the payment month. The latest month completes once the following month's payments land.";

// ─── Consolidated P&L — the GROUP statement ─────────────────────────────────
// Per-company P&Ls distort where the group pays centrally: HQ carries all
// Google Ads and most payroll, management fees sit as cost in one entity, and
// inter-company transfers (salary funding, stock, fees) stack as expense in
// every entity they pass through. Consolidation runs each company with
// inter-company legs EXCLUDED (they eliminate on consolidation by definition)
// and sums line-by-line — HQ-paid ads and payroll then appear exactly once,
// as the group's cost.
export const CONSOLIDATED_COMPANY_ID = "consolidated";

export async function buildConsolidatedPnl(input: { start: string; end: string }): Promise<PnlReport> {
  const { start, end } = input;
  const companies = Object.keys(BANK_ACCOUNT_SUFFIX);
  const reports = await Promise.all(
    companies.map((companyId) => buildSourcedPnl({ companyId, start, end, excludeInterCo: true })),
  );

  const mergeLines = (sections: PnlLine[][]): PnlLine[] => {
    const byCode = new Map<string, PnlLine>();
    for (const lines of sections) {
      for (const l of lines) {
        const cur = byCode.get(l.code);
        if (cur) cur.amount = round2(cur.amount + l.amount);
        else byCode.set(l.code, { ...l });
      }
    }
    return [...byCode.values()].sort((a, b) => b.amount - a.amount);
  };

  const income = mergeLines(reports.map((r) => r.income.lines));
  const cogs = mergeLines(reports.map((r) => r.cogs.lines));
  const expenses = mergeLines(reports.map((r) => r.expenses.lines));
  const notes = [...new Set(reports.flatMap((r) => r.notes ?? []))];
  const totalIncome = round2(reports.reduce((s, r) => s + r.income.total, 0));
  const cogsTotal = round2(reports.reduce((s, r) => s + r.cogs.total, 0));
  const totalExpenses = round2(reports.reduce((s, r) => s + r.expenses.total, 0));
  const grossProfit = round2(totalIncome - cogsTotal);

  return {
    companyId: CONSOLIDATED_COMPANY_ID,
    start,
    end,
    income: { type: "income", total: totalIncome, lines: income },
    cogs: { type: "cogs", total: cogsTotal, lines: cogs },
    grossProfit,
    expenses: { type: "expense", total: totalExpenses, lines: expenses },
    netIncome: round2(grossProfit - totalExpenses),
    txnCount: reports.reduce((s, r) => s + r.txnCount, 0),
    ...(notes.length ? { notes } : {}),
  };
}
