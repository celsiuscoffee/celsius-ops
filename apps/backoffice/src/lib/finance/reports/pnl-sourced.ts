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
  MANAGEMENT_FEE: -1,   // HQ bills one month in arrears
  EMPLOYEE_SALARY: -1,  // salary paid early in month N pays for month N-1 work
  UTILITIES: -1,        // TNB and water bill the prior month's usage
  STATUTORY_PAYMENT: -1, // EPF/SOCSO/EIS/PCB due by the 15th for the prior month
};
// PARTIMER is deliberately NOT shifted: the owner wants part timer wages
// matched to HR payroll runs in a later phase, so they stay on a cash basis
// until then. RENT is unshifted too, it is paid in the month, for the month.

// P&L line-name suffix for shift-recognised categories.
const ACCRUED_SUFFIX = " (accrued, paid the following month)";

// Categories that feed the P&L as their own opex line (not COGS, not
// non-operating, not the digital-ads dedup, not the flagged review pile).
// Only these keep an AP-matched bank line in opex, recognised at the matched
// invoice's issue month; AP-matched lines outside this set settle a
// procurement invoice already counted in COGS purchases and stay excluded.
function isOpexFeedCategory(cat: string | null): boolean {
  if (!cat) return false;
  return !BANK_COGS.has(cat) && !BANK_NONOPEX.has(cat) && !BANK_DIGITAL_ADS.has(cat) && !BANK_REVIEW.has(cat);
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
async function costPerBaseUnit(): Promise<Map<string, number>> {
  const sps = await prisma.supplierProduct.findMany({
    where: { isActive: true, price: { gt: 0 } },
    select: { productId: true, price: true, productPackage: { select: { conversionFactor: true } }, supplier: { select: { supplierCode: true } } },
  });
  const m = new Map<string, number>();
  for (const sp of sps) {
    if (sp.supplier?.supplierCode === "ADHOC") continue;
    const conv = Number(sp.productPackage?.conversionFactor ?? 0);
    if (conv <= 0) continue;
    const c = Number(sp.price) / conv;
    const ex = m.get(sp.productId);
    if (ex == null || c < ex) m.set(sp.productId, c);
  }
  return m;
}

// Value inventory at a period boundary from the nearest finalized
// (REVIEWED/SUBMITTED) stock count per outlet within 25 days. Returns null
// (→ caller falls back to the purchases proxy) when no usable count exists, or
// when a full count values implausibly low (a broken/mis-unit count) — so we
// never print a wrong COGS. coverage exposes how complete the count was.
async function valueInventoryAt(
  outletIds: string[],
  boundary: Date,
  cost: Map<string, number>,
): Promise<{ value: number; dates: string[]; coverage: string } | null> {
  if (!outletIds.length) return null;
  const since = new Date(boundary.getTime() - 25 * 86400_000);
  const counts = await prisma.stockCount.findMany({
    where: { outletId: { in: outletIds }, status: { in: ["REVIEWED", "SUBMITTED"] }, countDate: { gte: since, lte: boundary } },
    orderBy: { countDate: "desc" },
    select: { outletId: true, countDate: true, items: { select: { productId: true, countedQty: true } } },
  });
  // Per outlet, take the latest count that is a real FULL inventory: ≥100
  // counted items and a plausible value (skip partials like a 65-item count
  // and broken/mis-unit counts worth a few ringgit). Keep looking back through
  // the window if the newest count is partial.
  const MIN_ITEMS = 100;
  const used = new Map<string, { date: Date; value: number; items: number; costed: number }>();
  for (const c of counts) {
    if (used.has(c.outletId)) continue;
    let v = 0, n = 0, costed = 0;
    for (const it of c.items) {
      if (it.countedQty == null) continue;
      n++;
      const u = cost.get(it.productId);
      if (u != null) { costed++; v += Number(it.countedQty) * u; }
    }
    if (n < MIN_ITEMS || v < 2000) continue; // partial or broken — skip
    used.set(c.outletId, { date: c.countDate, value: v, items: n, costed });
  }
  if (used.size === 0) return null;

  let value = 0, tot = 0, costed = 0;
  const dates: string[] = [];
  for (const u of used.values()) { value += u.value; tot += u.items; costed += u.costed; dates.push(ymd(u.date)); }
  return { value: round2(value), dates: [...new Set(dates)].sort(), coverage: `${costed}/${tot} items` };
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
        select: { id: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
      })
    : [];
  const rev = { instore: 0, online: 0, grab: 0, foodpanda: 0 };
  let saleCount = 0;
  // Any accrual-shifted line in the period adds a short note to the report.
  let shiftedPresent = false;
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

  // True COGS = Opening inventory + Purchases − Closing inventory, valuing the
  // bounding stock counts at supplier cost. Falls back to purchases-only when
  // either boundary lacks a usable count (so it's never a wrong number — just
  // a flagged proxy).
  const costMap = await costPerBaseUnit();
  const [opening, closing] = await Promise.all([
    valueInventoryAt(outletIds, dStart(start), costMap),
    valueInventoryAt(outletIds, dEnd(end), costMap),
  ]);
  let cogsTotal: number;
  let cogsLines: PnlLine[];
  if (opening && closing) {
    cogsTotal = round2(opening.value + purchases - closing.value);
    cogsLines = [
      { code: "INV-OPEN", name: `Opening inventory (count ${opening.dates.join(", ")} · ${opening.coverage})`, amount: opening.value, parentCode: null },
      { code: "PROC", name: "Add: Purchases (procurement)", amount: purchases, parentCode: null },
      { code: "INV-CLOSE", name: `Less: Closing inventory (count ${closing.dates.join(", ")} · ${closing.coverage})`, amount: -closing.value, parentCode: null },
    ];
  } else {
    cogsTotal = purchases;
    cogsLines = purchases
      ? [{ code: "PROC", name: "Purchases (procurement, COGS = purchases, no usable stock count)", amount: purchases, parentCode: null }]
      : [];
  }

  // ─── EXPENSES: marketing (ads + bank) + other opex (bank) ────────────────
  const expenseLines: PnlLine[] = [];
  let totalExpenses = 0;

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
  if (outletIds.length) {
    const loyaltyRows = await prisma.$queryRaw<{ loyalty_id: string }[]>(Prisma.sql`
      SELECT "loyaltyOutletId" AS loyalty_id FROM "Outlet"
      WHERE id IN (${Prisma.join(outletIds)}) AND "loyaltyOutletId" IS NOT NULL
    `);
    const loyaltyIds = loyaltyRows.map((r) => r.loyalty_id);
    if (loyaltyIds.length) {
      const promoAgg = await prisma.$queryRaw<{ promo_sen: bigint }[]>(Prisma.sql`
        SELECT COALESCE(SUM(grab_merchant_promo), 0) AS promo_sen
        FROM pos_orders
        WHERE source = 'grabfood' AND status = 'completed'
          AND outlet_id IN (${Prisma.join(loyaltyIds)})
          AND created_at::date BETWEEN ${start}::date AND ${end}::date
      `);
      const grabPromo = round2(Number(promoAgg[0]?.promo_sen ?? 0) / 100);
      if (grabPromo) {
        expenseLines.push({ code: "MKT-GRAB-PROMO", name: "GrabFood promos (merchant-funded)", amount: grabPromo, parentCode: null });
        totalExpenses += grabPromo;
      }

      const adAgg = await prisma.$queryRaw<{ ad_sen: bigint }[]>(Prisma.sql`
        SELECT COALESCE(SUM(amount_sen), 0) AS ad_sen
        FROM grab_ads_spend
        WHERE outlet_id IN (${Prisma.join(loyaltyIds)})
          AND period_start BETWEEN ${start}::date AND ${end}::date
      `);
      const grabAds = round2(Number(adAgg[0]?.ad_sen ?? 0) / 100);
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
    const gr = await effectiveGrabRate(end);
    const grabComm = round2(grabGrossRevenue * gr.rate);
    expenseLines.push({
      code: "MKT-GRAB-COMM",
      name: `GrabFood commission (${Math.round(gr.rate * 100)}% ${gr.source === "recon" ? "effective, from payout recon" : "estimated"})`,
      amount: grabComm,
      parentCode: null,
    });
    totalExpenses += grabComm;
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
      if (cat && (BANK_COGS.has(cat) || BANK_NONOPEX.has(cat) || BANK_DIGITAL_ADS.has(cat))) continue;
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
    // report only fills once the following month's payments are recorded.
    ...(shiftedPresent ? { notes: [ACCRUAL_NOTE] } : {}),
  };
}

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
