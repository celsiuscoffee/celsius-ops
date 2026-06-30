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
  "CAPITAL", "LOAN", "MANAGEMENT_FEE", "INTERCO_PEOPLE", "INTERCO_INVESTMENTS",
  "INTERCO_EXPENSES", "INVESTMENTS", "EQUIPMENTS", "ADTD", "TRANSFER_NOT_SUCCESSFUL",
  "DIVIDEND", "DIRECTORS_ALLOWANCE",  // shareholder/owner distributions, not P&L opex
]);
// Catch-all + unclassified bank outflows. Surfaced as a flagged "needs review"
// line rather than buried in opex, because it double-counts COGS (unnamed
// supplier payments already in procurement) + internal transfers until the AP
// auto-match re-tags them. Visible so it can't silently inflate the P&L.
const BANK_REVIEW = new Set(["OTHER_OUTFLOW"]);

// GrabFood revenue is booked GROSS in income, but Grab deducts a commission
// (marketplace fee) at source before paying out — so it never appears in the
// bank feed and must be recognised as a cost here, else Grab margin is wildly
// overstated. This is an ESTIMATE at a flat rate; the exact per-order
// commission lives in the GrabFood Partner settlement report (TODO: source it
// from the API and replace this estimate). Commission is the selling company's
// cost, so it attributes to whichever company booked the Grab revenue —
// independent of which bank account the net payout lands in.
const GRAB_COMMISSION_RATE = 0.30;

function humanCat(c: string | null): string {
  if (!c) return "Unclassified";
  return c.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
const dStart = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dEnd = (s: string) => new Date(`${s}T23:59:59.999Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

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
}): Promise<PnlReport> {
  const { companyId, start, end } = input;
  const client = getFinanceClient();
  const defaultCompany = await getDefaultCompanyId();

  // Company's outlets (UUIDs) — drive both revenue and COGS.
  const { data: oc } = await client
    .from("fin_outlet_companies").select("outlet_id").eq("company_id", companyId);
  const outletIds = (oc ?? []).map((r) => r.outlet_id as string);

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
    { code: "REV-INSTORE", name: "Sales — In-store (dine-in + takeaway)", amount: round2(rev.instore), parentCode: null },
    { code: "REV-ONLINE", name: "Sales — Online (pickup + table-QR)", amount: round2(rev.online), parentCode: null },
    { code: "REV-GRAB", name: "Sales — GrabFood (gross)", amount: round2(rev.grab), parentCode: null },
    { code: "REV-PANDA", name: "Sales — FoodPanda", amount: round2(rev.foodpanda), parentCode: null },
  ].filter((l) => l.amount !== 0);
  const totalIncome = round2(rev.instore + rev.online + rev.grab + rev.foodpanda);

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
      ? [{ code: "PROC", name: "Purchases (procurement) — no usable stock count, COGS = purchases", amount: purchases, parentCode: null }]
      : [];
  }

  // ─── EXPENSES: marketing (ads + bank) + other opex (bank) ────────────────
  const expenseLines: PnlLine[] = [];
  let totalExpenses = 0;

  // Marketing — digital ads are brand-level (ad accounts carry no outlet), so
  // attribute them to the default company only to avoid splitting/duplication.
  if (companyId === defaultCompany) {
    const adsAgg = await prisma.adsMetricDaily.aggregate({
      _sum: { costMicros: true },
      where: { date: { gte: dStart(start), lte: dEnd(end) } },
    });
    const adsSpend = round2(Number(adsAgg._sum.costMicros ?? 0) / 1_000_000);
    if (adsSpend) {
      expenseLines.push({ code: "MKT-ADS", name: "Marketing — Digital ads (Google)", amount: adsSpend, parentCode: null });
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
        expenseLines.push({ code: "MKT-GRAB-PROMO", name: "Marketing — GrabFood promos", amount: grabPromo, parentCode: null });
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
        expenseLines.push({ code: "MKT-GRAB-ADS", name: "Marketing — GrabAds", amount: grabAds, parentCode: null });
        totalExpenses += grabAds;
      }
    }
  }

  // GrabFood commission (marketplace fee) — estimated on the gross Grab
  // revenue booked above, since Grab nets it out before payout (never in the
  // bank feed). Find the Grab income code(s) and apply the rate.
  if (grabGrossRevenue > 0) {
    const grabComm = round2(grabGrossRevenue * GRAB_COMMISSION_RATE);
    expenseLines.push({
      code: "MKT-GRAB-COMM",
      name: `Marketplace fee — GrabFood commission (est. ${Math.round(GRAB_COMMISSION_RATE * 100)}%)`,
      amount: grabComm,
      parentCode: null,
    });
    totalExpenses += grabComm;
  }

  // Bank-classified outflows for this company's account.
  const suffix = BANK_ACCOUNT_SUFFIX[companyId];
  if (suffix) {
    const grouped = await prisma.bankStatementLine.groupBy({
      by: ["category"],
      where: {
        direction: "DR",
        txnDate: { gte: dStart(start), lte: dEnd(end) },
        statement: { accountName: { contains: suffix } },
        apInvoiceId: null, // AP-matched lines settle a procurement invoice (COGS) — not opex
      },
      _sum: { amount: true },
    });
    for (const g of grouped) {
      const cat = (g.category as string | null) ?? null;
      const amt = round2(Number(g._sum?.amount ?? 0));
      if (!amt) continue;
      if (cat && (BANK_COGS.has(cat) || BANK_NONOPEX.has(cat) || BANK_DIGITAL_ADS.has(cat))) continue;
      const isReview = !cat || BANK_REVIEW.has(cat);
      const isMkt = !!cat && BANK_MARKETING.has(cat);
      expenseLines.push({
        code: `BANK:${cat ?? "NULL"}`,
        name: isReview ? "Unclassified — pending AP match (review)" : (isMkt ? "Marketing — " : "") + humanCat(cat),
        amount: amt,
        parentCode: null,
      });
      totalExpenses += amt;
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
  };
}
