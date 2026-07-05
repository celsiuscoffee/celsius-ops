// Drill-down for the SOURCED P&L. Its line codes (REV-*, PROC, INV-*, MKT-*,
// BANK:*) are synthetic — they don't exist in the GL — so the ledger drill
// (pnlDrillDown) always came back empty for them. Each code here drills into
// the records the P&L line was actually built from, using the SAME queries as
// buildSourcedPnl so the drill total ties to the line amount.
//
//   REV-*          → unified sales (per MYT day, per channel)
//   PROC           → procurement invoices in the period
//   INV-OPEN/CLOSE → the stock-count valuation used for the boundary
//   MKT-ADS        → Google Ads daily spend
//   MKT-GRAB-PROMO → merchant-funded Grab promos (per day)
//   MKT-GRAB-ADS   → manually entered GrabAds spend rows
//   MKT-GRAB-COMM  → the commission estimate (rate × gross)
//   BANK:<CAT>     → the classified bank-statement lines themselves

import { prisma } from "@/lib/prisma";
import { Prisma, type CashCategory } from "@prisma/client";
import { getFinanceClient } from "../supabase";
import { getDefaultCompanyId } from "../companies";
import { depreciationByAsset } from "../fixed-assets";
import { effectiveGrabRate, fetchRecognisedBankLines, outletPayrollWeights } from "./pnl-sourced";
import { getUnifiedSalesForOutlet } from "@/app/api/sales/_lib/unified-sales";

const round2 = (n: number) => Math.round(n * 100) / 100;
const dStart = (s: string) => new Date(`${s}T00:00:00.000Z`);
const dEnd = (s: string) => new Date(`${s}T23:59:59.999Z`);

export type DrillLine = {
  transactionId: string;
  txnDate: string;
  description: string;
  amount: number;
  debit: number;
  credit: number;
  // Extra detail shown when a bank-line row is expanded ("see the tx behind it").
  meta?: {
    reference?: string | null;
    category?: string | null;
    company?: string | null;
    account?: string | null;
    isInterCo?: boolean;
    classifiedBy?: string | null;
    ruleName?: string | null;
    // Fix-in-place: the bank line id lets the UI recategorise or unmatch the
    // row straight from the report, QuickBooks style.
    bankLineId?: string;
    direction?: "DR" | "CR";
    apInvoiceId?: string | null;
    matchedInvoice?: MatchedInvoiceSummary | null;
    // Expense-month recognition: the month (YYYY-MM) the P&L recognised this
    // line in, and whether a per-line override drove it. Lets the UI flag
    // lines whose expense month differs from their cash date.
    expenseMonth?: string | null;
    expenseMonthOverride?: boolean;
    // Journal-backed rows (ledger drill): the agent that posted the journal.
    // "bank" journals can expand into their source bank lines.
    glAgent?: string | null;
  };
};

export type MatchedInvoiceSummary = { invoiceNumber: string | null; vendor: string | null; amount: number };

// One batched Invoice lookup for AP-matched bank lines. BankStatementLine has
// no prisma relation on apInvoiceId, so the join is manual.
export async function matchedInvoiceSummaries(invoiceIds: Array<string | null | undefined>): Promise<Map<string, MatchedInvoiceSummary>> {
  const ids = [...new Set(invoiceIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const invoices = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    select: { id: true, invoiceNumber: true, vendorName: true, amount: true, supplier: { select: { name: true } } },
  });
  return new Map(invoices.map((i) => [i.id, {
    invoiceNumber: i.invoiceNumber ?? null,
    vendor: i.supplier?.name ?? i.vendorName ?? null,
    amount: round2(Number(i.amount)),
  }]));
}

const CONSOLIDATED = "consolidated";

// Mirrors BANK_ACCOUNT_SUFFIX in pnl-sourced.ts.
const BANK_ACCOUNT_SUFFIX: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

// Company that owns a Maybank account, from the 4-digit suffix in the name.
function companyForAccount(accountName: string | null): string {
  const a = (accountName ?? "").toUpperCase();
  if (a.includes("2644") || a.includes("CONEZION")) return "Celsius Coffee Conezion";
  if (a.includes("9345") || a.includes("TAMARIND")) return "Celsius Coffee Tamarind";
  if (a.includes("4384") || a.includes("CELSIUS COFFEE SDN")) return "Celsius Coffee SB";
  return accountName ?? "—";
}
export function isSourcedPnlCode(code: string): boolean {
  return /^(REV-|PROC$|INV-|MKT-|BANK:|DEP$)/.test(code);
}

async function companyOutlets(companyId: string, outletId?: string | null): Promise<string[]> {
  const client = getFinanceClient();
  // Consolidated → every company's outlets, so the drill spans all entities.
  let q = client.from("fin_outlet_companies").select("outlet_id");
  if (companyId !== CONSOLIDATED) q = q.eq("company_id", companyId);
  const { data } = await q;
  const all = (data ?? []).map((r) => r.outlet_id as string);
  return outletId && all.includes(outletId) ? [outletId] : all;
}

// Revenue lines: unified sales aggregated per MYT day for the code's channel.
async function drillRevenue(code: string, companyId: string, start: string, end: string, outletId?: string | null): Promise<DrillLine[]> {
  const outletIds = await companyOutlets(companyId, outletId);
  if (!outletIds.length) return [];
  const outlets = await prisma.outlet.findMany({
    where: { id: { in: outletIds } },
    select: { id: true, name: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
  });
  const match = (lbl: string, isQR: boolean, channel: string): boolean => {
    const l = lbl.toLowerCase();
    if (code === "REV-GRAB") return /grab/.test(l);
    if (code === "REV-PANDA") return /panda/.test(l);
    if (/grab|panda/.test(l)) return false;
    const online = isQR || channel === "delivery";
    return code === "REV-ONLINE" ? online : !online;
  };
  // day|outlet → {orders, amount}
  const agg = new Map<string, { day: string; outlet: string; n: number; amt: number }>();
  for (const o of outlets) {
    const sales = await getUnifiedSalesForOutlet(
      { outletId: o.id, storehubStoreId: null, loyaltyOutletId: o.loyaltyOutletId, pickupStoreId: o.pickupStoreId, cutoverAt: o.posNativeCutoverAt },
      dStart(start),
      dEnd(end),
    );
    for (const s of sales) {
      if (!match(s.channelLabel ?? "", s.isDeliveryQR, s.channel)) continue;
      const day = new Date(new Date(s.ts).getTime() + 8 * 3600_000).toISOString().slice(0, 10); // MYT day
      const k = `${day}|${o.name}`;
      const cur = agg.get(k) ?? { day, outlet: o.name, n: 0, amt: 0 };
      cur.n++; cur.amt += s.total;
      agg.set(k, cur);
    }
  }
  return [...agg.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || a.outlet.localeCompare(b.outlet))
    .map((r) => ({
      transactionId: `rev-${r.day}-${r.outlet}`,
      txnDate: r.day,
      description: `${r.outlet}, ${r.n} orders`,
      amount: round2(r.amt),
      debit: 0,
      credit: round2(r.amt),
    }));
}

// PROC: the procurement invoices summed into the purchases line.
async function drillPurchases(companyId: string, start: string, end: string, outletId?: string | null): Promise<DrillLine[]> {
  const outletIds = await companyOutlets(companyId, outletId);
  if (!outletIds.length) return [];
  const invoices = await prisma.invoice.findMany({
    where: { issueDate: { gte: dStart(start), lte: dEnd(end) }, outletId: { in: outletIds } },
    select: { id: true, invoiceNumber: true, issueDate: true, amount: true, vendorName: true, supplier: { select: { name: true } }, outlet: { select: { name: true } } },
    orderBy: { issueDate: "asc" },
    take: 500,
  });
  return invoices.map((inv) => ({
    transactionId: inv.id,
    txnDate: inv.issueDate.toISOString().slice(0, 10),
    description: `${inv.supplier?.name ?? inv.vendorName ?? "(no vendor)"} · ${inv.invoiceNumber} · ${inv.outlet?.name ?? ""}`.trim(),
    amount: round2(Number(inv.amount)),
    debit: round2(Number(inv.amount)),
    credit: 0,
  }));
}

// MKT-ADS: Google Ads spend per day, attributed to the company/outlet via the
// campaign's outletId — mirrors the P&L so the drill ties to the line.
async function drillAds(companyId: string, start: string, end: string, outletId?: string | null): Promise<DrillLine[]> {
  const outletIds = await companyOutlets(companyId, outletId);
  const defaultCompany = await getDefaultCompanyId();
  const includeUntagged = !outletId && (companyId === CONSOLIDATED || companyId === defaultCompany);
  const outletSet = new Set(outletIds);
  const rows = await prisma.$queryRaw<{ date: Date; outlet_id: string | null; spend: number }[]>(Prisma.sql`
    SELECT m.date, c.outlet_id, COALESCE(SUM(m.cost_micros), 0)::float / 1e6 AS spend
    FROM ads_metric_daily m LEFT JOIN ads_campaign c ON c.id = m.campaign_id
    WHERE m.date >= ${dStart(start)} AND m.date <= ${dEnd(end)}
    GROUP BY m.date, c.outlet_id ORDER BY m.date ASC
  `);
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const keep = (r.outlet_id && outletSet.has(r.outlet_id)) || (!r.outlet_id && includeUntagged);
    if (!keep) continue;
    const day = r.date.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(r.spend));
  }
  return [...byDay.entries()]
    .map(([day, amt]) => ({ day, amt: round2(amt) }))
    .filter((r) => r.amt !== 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((r) => ({ transactionId: `ads-${r.day}`, txnDate: r.day, description: "Google Ads spend", amount: r.amt, debit: r.amt, credit: 0 }));
}

// Bridge Outlet UUIDs → loyalty ids (pos_orders / grab_ads_spend key).
async function loyaltyIds(outletIds: string[]): Promise<{ id: string; name: string }[]> {
  if (!outletIds.length) return [];
  const rows = await prisma.$queryRaw<{ loyalty_id: string; name: string }[]>(Prisma.sql`
    SELECT "loyaltyOutletId" AS loyalty_id, name FROM "Outlet"
    WHERE id IN (${Prisma.join(outletIds)}) AND "loyaltyOutletId" IS NOT NULL
  `);
  return rows.map((r) => ({ id: r.loyalty_id, name: r.name }));
}

async function drillGrabPromo(companyId: string, start: string, end: string, outletId?: string | null): Promise<DrillLine[]> {
  const lids = await loyaltyIds(await companyOutlets(companyId, outletId));
  if (!lids.length) return [];
  const rows = await prisma.$queryRaw<{ day: string; outlet_id: string; n: bigint; promo_sen: bigint }[]>(Prisma.sql`
    SELECT created_at::date::text AS day, outlet_id, COUNT(*) AS n, COALESCE(SUM(grab_merchant_promo), 0) AS promo_sen
    FROM pos_orders
    WHERE source = 'grabfood' AND status = 'completed' AND grab_merchant_promo > 0
      AND outlet_id IN (${Prisma.join(lids.map((l) => l.id))})
      AND created_at::date BETWEEN ${start}::date AND ${end}::date
    GROUP BY 1, 2 ORDER BY 1, 2
  `);
  const nameOf = new Map(lids.map((l) => [l.id, l.name]));
  return rows.map((r) => ({
    transactionId: `grabpromo-${r.day}-${r.outlet_id}`,
    txnDate: r.day,
    description: `${nameOf.get(r.outlet_id) ?? r.outlet_id}, merchant-funded promo on ${Number(r.n)} orders`,
    amount: round2(Number(r.promo_sen) / 100),
    debit: round2(Number(r.promo_sen) / 100),
    credit: 0,
  }));
}

async function drillGrabAds(companyId: string, start: string, end: string, outletId?: string | null): Promise<DrillLine[]> {
  const lids = await loyaltyIds(await companyOutlets(companyId, outletId));
  if (!lids.length) return [];
  const rows = await prisma.$queryRaw<{ id: string; outlet_id: string; period_start: string; period_end: string; amount_sen: number; note: string | null }[]>(Prisma.sql`
    SELECT id, outlet_id, period_start::text, period_end::text, amount_sen, note
    FROM grab_ads_spend
    WHERE outlet_id IN (${Prisma.join(lids.map((l) => l.id))})
      AND period_start BETWEEN ${start}::date AND ${end}::date
    ORDER BY period_start
  `);
  const nameOf = new Map(lids.map((l) => [l.id, l.name]));
  return rows.map((r) => ({
    transactionId: r.id,
    txnDate: r.period_start,
    description: `${nameOf.get(r.outlet_id) ?? r.outlet_id}, GrabAds ${r.period_start} to ${r.period_end}${r.note ? ` (${r.note})` : ""}`,
    amount: round2(r.amount_sen / 100),
    debit: round2(r.amount_sen / 100),
    credit: 0,
  }));
}

// DEP: per-asset depreciation for the period, from the SAME math as the P&L
// line (lib/finance/fixed-assets.ts), so the drill total ties to the line.
async function drillDepreciation(companyId: string, start: string, end: string, outletId?: string | null): Promise<DrillLine[]> {
  const rows = await depreciationByAsset({
    companyId: companyId === CONSOLIDATED ? null : companyId,
    start,
    end,
    outletId,
  });
  return rows.map(({ asset, amount }) => ({
    transactionId: asset.id,
    txnDate: asset.acquiredDate,
    description: `${asset.name}: cost RM${asset.cost.toFixed(2)}, life ${asset.usefulLifeMonths} months (${asset.accountCode})`,
    amount,
    debit: amount,
    credit: 0,
    meta: { company: asset.companyId, account: asset.accountCode },
  }));
}

// BANK:<CAT> opex drill: the classified bank lines behind the line, using the
// SAME expense-month recognition as buildSourcedPnl (per-line override >
// matched invoice issue month > category shift map > cash month), so the
// drill total ties to the line for shifted categories too. Also serves the
// REV-MGMT income drill on the CR side.
async function drillBankRecognised(
  cat: string,
  companyId: string,
  start: string,
  end: string,
  outletId?: string | null,
  direction: "DR" | "CR" = "DR",
): Promise<DrillLine[]> {
  const consolidated = companyId === CONSOLIDATED;
  const suffix = BANK_ACCOUNT_SUFFIX[companyId];
  if (!consolidated && !suffix) return [];
  const all = await fetchRecognisedBankLines({
    direction,
    start,
    end,
    suffix: consolidated ? undefined : suffix,
    consolidated,
    outletId,
  });
  const lines = all.filter((l) => (cat === "NULL" ? l.category === null : l.category === cat));
  const invById = await matchedInvoiceSummaries(lines.map((l) => l.apInvoiceId));
  return lines.map((l) => ({
    transactionId: l.id,
    txnDate: l.txnDate,
    description: l.description || "(no description)",
    amount: l.amount,
    debit: direction === "DR" ? l.amount : 0,
    credit: direction === "CR" ? l.amount : 0,
    meta: {
      reference: l.reference,
      category: l.category,
      company: companyForAccount(l.accountName),
      account: l.accountName,
      isInterCo: l.isInterCo,
      classifiedBy: l.classifiedBy,
      ruleName: l.ruleName,
      bankLineId: l.id,
      direction,
      apInvoiceId: l.apInvoiceId,
      matchedInvoice: l.apInvoiceId ? invById.get(l.apInvoiceId) ?? null : null,
      expenseMonth: l.recognisedMonth,
      expenseMonthOverride: l.hasOverride,
    },
  }));
}

// Cash-dated CR drill for the bank-sourced income lines (GastroHub,
// Meetings & Events), those P&L lines aggregate at the transaction date.
async function drillBank(cat: string, companyId: string, start: string, end: string, outletId?: string | null, direction: "DR" | "CR" = "DR"): Promise<DrillLine[]> {
  const consolidated = companyId === CONSOLIDATED;
  const suffix = BANK_ACCOUNT_SUFFIX[companyId];
  if (!consolidated && !suffix) return [];
  const lines = await prisma.bankStatementLine.findMany({
    where: {
      direction,
      txnDate: { gte: dStart(start), lte: dEnd(end) },
      // Per-company: filter to that account. Consolidated: all accounts, but
      // drop inter-company legs (they eliminate on consolidation) so the drill
      // ties to the consolidated line.
      ...(consolidated ? { isInterCo: false } : { statement: { accountName: { contains: suffix } } }),
      ...(direction === "DR" ? { apInvoiceId: null } : {}),
      category: cat === "NULL" ? null : (cat as CashCategory),
      ...(outletId ? { outletId } : {}),
    },
    select: {
      id: true, txnDate: true, description: true, amount: true, reference: true,
      category: true, isInterCo: true, classifiedBy: true, ruleName: true, apInvoiceId: true,
      statement: { select: { accountName: true } },
    },
    orderBy: { txnDate: "asc" },
    take: 400,
  });
  const invById = await matchedInvoiceSummaries(lines.map((l) => l.apInvoiceId));
  return lines.map((l) => ({
    transactionId: l.id,
    txnDate: l.txnDate.toISOString().slice(0, 10),
    description: l.description ?? "(no description)",
    amount: round2(Number(l.amount)),
    debit: direction === "DR" ? round2(Number(l.amount)) : 0,
    credit: direction === "CR" ? round2(Number(l.amount)) : 0,
    meta: {
      reference: l.reference,
      category: l.category as string | null,
      company: companyForAccount(l.statement?.accountName ?? null),
      account: l.statement?.accountName ?? null,
      isInterCo: l.isInterCo,
      classifiedBy: l.classifiedBy,
      ruleName: l.ruleName,
      bankLineId: l.id,
      direction,
      apInvoiceId: l.apInvoiceId,
      matchedInvoice: l.apInvoiceId ? invById.get(l.apInvoiceId) ?? null : null,
    },
  }));
}

// Allocated people-cost drill (EMPLOYEE_SALARY, STATUTORY_PAYMENT) in a
// per-outlet view. These P&L lines are an ALLOCATION of the entity total by
// staff payroll weight, not per-outlet transactions, so the honest drill shows
// the entity's actual salary/statutory bank lines for the period with a header
// row stating this outlet's weight percent and the entity total. The
// transactions are entity-level; only the P&L line is the outlet's share.
async function drillAllocatedPeopleCost(
  cat: string,
  companyId: string,
  start: string,
  end: string,
  outletId: string,
): Promise<DrillLine[]> {
  // Entity-level lines: no outletId filter, so the whole entity's salary or
  // statutory shows (matches the entity total the P&L allocated from).
  const lines = await drillBankRecognised(cat, companyId, start, end, null, "DR");
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const weights = await outletPayrollWeights(companyId);
  const share = weights.get(outletId) ?? 0;
  const sharePct = Math.round(share * 1000) / 10;
  const allocated = round2(total * share);
  const header: DrillLine = {
    transactionId: `alloc-${cat}`,
    txnDate: end,
    description: `Allocation basis: this outlet's P&L figure is ${sharePct}% of the entity total RM${total.toFixed(2)}, which is RM${allocated.toFixed(2)}, split by staff payroll weight. The rows below are the entity's actual salary and statutory bank lines for the period (entity-level, not per outlet).`,
    amount: 0,
    debit: 0,
    credit: 0,
  };
  return [header, ...lines];
}

export async function sourcedPnlDrillDown(args: {
  companyId: string;
  code: string;
  start: string;
  end: string;
  outletId?: string | null;
}): Promise<DrillLine[]> {
  const { companyId, code, start, end, outletId } = args;
  // Bank-settled income channels drill into their bank inflow lines (they have
  // no POS orders behind them) — must route before the generic REV-* branch.
  if (code === "REV-GASTRO") return drillBank("GASTROHUB", companyId, start, end, outletId, "CR");
  if (code === "REV-EVENTS") return drillBank("MEETINGS_EVENTS", companyId, start, end, outletId, "CR");
  // Management fee income (HQ side): the MANAGEMENT_FEE inflow lines, with the
  // same one-month-arrears recognition as the P&L line.
  if (code === "REV-MGMT") return drillBankRecognised("MANAGEMENT_FEE", companyId, start, end, outletId, "CR");
  if (code.startsWith("REV-")) return drillRevenue(code, companyId, start, end, outletId);
  if (code === "PROC") return drillPurchases(companyId, start, end, outletId);
  if (code === "MKT-ADS") return drillAds(companyId, start, end, outletId);
  if (code === "MKT-GRAB-PROMO") return drillGrabPromo(companyId, start, end, outletId);
  if (code === "MKT-GRAB-ADS") return drillGrabAds(companyId, start, end, outletId);
  if (code === "DEP") return drillDepreciation(companyId, start, end, outletId);
  // Every opex bank line drills through the shared expense-month recognition
  // (override > matched invoice month > category shift > cash), so shifted
  // categories like management fee, salary, utilities and statutory tie to
  // their accrual-recognised P&L lines.
  if (code.startsWith("BANK:")) {
    const cat = code.slice(5);
    // Per-outlet salary/statutory are an allocation of the entity total, so drill
    // the entity's lines with a header note about this outlet's share.
    if (outletId && (cat === "EMPLOYEE_SALARY" || cat === "STATUTORY_PAYMENT")) {
      return drillAllocatedPeopleCost(cat, companyId, start, end, outletId);
    }
    return drillBankRecognised(cat, companyId, start, end, outletId);
  }
  if (code === "MKT-GRAB-COMM") {
    // A derived line, not transactions — the drawer explains the calculation.
    const [rev, gr] = await Promise.all([
      drillRevenue("REV-GRAB", companyId, start, end, outletId),
      effectiveGrabRate(end),
    ]);
    const gross = round2(rev.reduce((s, r) => s + r.amount, 0));
    const est = round2(gross * gr.rate);
    // Grab's payout nets off commission AND marketing (promos, GrabAds); the
    // marketing part is booked on its own P&L lines, so the commission rate
    // excludes it — else the marketing spend would double-count.
    const basis = gr.source === "recon"
      ? `Effective commission ${Math.round(gr.rate * 100)}% from the payout reconciliation: over the trailing window, gross Grab sales RM${gr.windowGross.toFixed(2)} less payouts RM${gr.windowPayouts.toFixed(2)}, merchant promos RM${gr.windowPromos.toFixed(2)} and GrabAds RM${gr.windowAds.toFixed(2)} (both booked as their own marketing lines) leaves the commission portion.`
      : `Fallback rate ${Math.round(gr.rate * 100)}% (payout window too thin to derive the effective rate).`;
    return [{
      transactionId: "grab-comm-estimate",
      txnDate: end,
      description: `Commission on RM${gross.toFixed(2)} gross GrabFood sales this period. ${basis} Exact per-order commission lives in the Grab settlement report.`,
      amount: est,
      debit: est,
      credit: 0,
    }];
  }
  if (code.startsWith("INV-")) {
    return [{
      transactionId: `inv-${code}`,
      txnDate: code === "INV-OPEN" ? start : end,
      description: "Inventory valuation from the nearest finalized full stock count (valued at cheapest active supplier cost). See the count date and item coverage in the line name; the count itself lives in Procurement → Stock Counts.",
      amount: 0,
      debit: 0,
      credit: 0,
    }];
  }
  return [];
}
