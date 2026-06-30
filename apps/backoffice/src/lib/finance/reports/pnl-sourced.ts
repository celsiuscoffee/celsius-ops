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
const BANK_NONOPEX = new Set([                                                    // internal / financing / capex — not operating
  "CAPITAL", "LOAN", "MANAGEMENT_FEE", "INTERCO_PEOPLE", "INTERCO_INVESTMENTS",
  "INTERCO_EXPENSES", "INVESTMENTS", "EQUIPMENTS", "ADTD", "TRANSFER_NOT_SUCCESSFUL",
]);

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

export async function buildSourcedPnl(input: {
  companyId: string;
  start: string;
  end: string;
}): Promise<PnlReport> {
  const { companyId, start, end } = input;
  const client = getFinanceClient();
  const defaultCompany = await getDefaultCompanyId();

  // ─── INCOME: net sales from the AR EOD feed (incl. drafts) ───────────────
  const { data: incomeAccts } = await client
    .from("fin_accounts").select("code, name").eq("type", "income");
  const incomeName = new Map((incomeAccts ?? []).map((a) => [a.code as string, a.name as string]));

  const { data: txns } = await client
    .from("fin_transactions")
    .select("id")
    .eq("company_id", companyId)
    .in("status", ["draft", "posted"])
    .gte("txn_date", start)
    .lte("txn_date", end);
  const txnIds = (txns ?? []).map((t) => t.id as string);

  const incomeByCode = new Map<string, number>();
  let totalIncome = 0;
  for (let i = 0; i < txnIds.length; i += 200) {
    const chunk = txnIds.slice(i, i + 200);
    const { data: lines } = await client
      .from("fin_journal_lines")
      .select("account_code, debit, credit")
      .in("transaction_id", chunk);
    for (const l of lines ?? []) {
      const code = l.account_code as string;
      if (!incomeName.has(code)) continue;
      const v = Number(l.credit) - Number(l.debit); // income is credit-normal
      incomeByCode.set(code, (incomeByCode.get(code) ?? 0) + v);
      totalIncome += v;
    }
  }
  const incomeLines: PnlLine[] = [...incomeByCode.entries()]
    .filter(([, amt]) => round2(amt) !== 0)
    .map(([code, amt]) => ({ code, name: incomeName.get(code) ?? code, amount: round2(amt), parentCode: null }))
    .sort((a, b) => a.code.localeCompare(b.code));
  totalIncome = round2(totalIncome);

  // ─── COGS: supplier invoices (procurement) ───────────────────────────────
  const { data: oc } = await client
    .from("fin_outlet_companies").select("outlet_id").eq("company_id", companyId);
  const outletIds = (oc ?? []).map((r) => r.outlet_id as string);
  const invDate = { gte: dStart(start), lte: dEnd(end) };
  const invAgg = await prisma.invoice.aggregate({
    _sum: { amount: true },
    where: { issueDate: invDate, outletId: { in: outletIds.length ? outletIds : ["__none__"] } },
  });
  const cogsTotal = round2(Number(invAgg._sum?.amount ?? 0));
  const cogsLines: PnlLine[] = cogsTotal
    ? [{ code: "PROC", name: "Supplier purchases (procurement)", amount: cogsTotal, parentCode: null }]
    : [];

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
  const grabGross = [...incomeByCode.entries()]
    .filter(([code]) => /grab/i.test(incomeName.get(code) ?? code))
    .reduce((s, [, v]) => s + v, 0);
  if (grabGross > 0) {
    const grabComm = round2(grabGross * GRAB_COMMISSION_RATE);
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
      },
      _sum: { amount: true },
    });
    for (const g of grouped) {
      const cat = (g.category as string | null) ?? null;
      const amt = round2(Number(g._sum?.amount ?? 0));
      if (!amt) continue;
      if (cat && (BANK_COGS.has(cat) || BANK_NONOPEX.has(cat) || BANK_DIGITAL_ADS.has(cat))) continue;
      const isMkt = !!cat && BANK_MARKETING.has(cat);
      expenseLines.push({
        code: `BANK:${cat ?? "NULL"}`,
        name: (isMkt ? "Marketing — " : "") + humanCat(cat),
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
    txnCount: txnIds.length,
  };
}
