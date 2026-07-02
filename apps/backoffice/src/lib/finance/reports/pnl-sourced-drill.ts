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
import { effectiveGrabRate } from "./pnl-sourced";
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
};

// Mirrors BANK_ACCOUNT_SUFFIX in pnl-sourced.ts.
const BANK_ACCOUNT_SUFFIX: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

export function isSourcedPnlCode(code: string): boolean {
  return /^(REV-|PROC$|INV-|MKT-|BANK:)/.test(code);
}

async function companyOutlets(companyId: string, outletId?: string | null): Promise<string[]> {
  const client = getFinanceClient();
  const { data } = await client.from("fin_outlet_companies").select("outlet_id").eq("company_id", companyId);
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
      description: `${r.outlet} — ${r.n} orders`,
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

// MKT-ADS: Google Ads spend per day.
async function drillAds(start: string, end: string): Promise<DrillLine[]> {
  const rows = await prisma.adsMetricDaily.groupBy({
    by: ["date"],
    where: { date: { gte: dStart(start), lte: dEnd(end) } },
    _sum: { costMicros: true },
    orderBy: { date: "asc" },
  });
  return rows
    .map((r) => ({ day: r.date.toISOString().slice(0, 10), amt: round2(Number(r._sum.costMicros ?? 0) / 1_000_000) }))
    .filter((r) => r.amt !== 0)
    .map((r) => ({
      transactionId: `ads-${r.day}`,
      txnDate: r.day,
      description: "Google Ads spend",
      amount: r.amt,
      debit: r.amt,
      credit: 0,
    }));
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
    description: `${nameOf.get(r.outlet_id) ?? r.outlet_id} — merchant-funded promo on ${Number(r.n)} orders`,
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
    description: `${nameOf.get(r.outlet_id) ?? r.outlet_id} — GrabAds ${r.period_start} to ${r.period_end}${r.note ? ` (${r.note})` : ""}`,
    amount: round2(r.amount_sen / 100),
    debit: round2(r.amount_sen / 100),
    credit: 0,
  }));
}

// BANK:<CAT> — the classified bank lines behind the opex line. Also serves the
// bank-sourced income lines (GastroHub, Meetings & Events) on the CR side.
async function drillBank(cat: string, companyId: string, start: string, end: string, outletId?: string | null, direction: "DR" | "CR" = "DR"): Promise<DrillLine[]> {
  const suffix = BANK_ACCOUNT_SUFFIX[companyId];
  if (!suffix) return [];
  const lines = await prisma.bankStatementLine.findMany({
    where: {
      direction,
      txnDate: { gte: dStart(start), lte: dEnd(end) },
      statement: { accountName: { contains: suffix } },
      ...(direction === "DR" ? { apInvoiceId: null } : {}),
      category: cat === "NULL" ? null : (cat as CashCategory),
      ...(outletId ? { outletId } : {}),
    },
    select: { id: true, txnDate: true, description: true, amount: true },
    orderBy: { txnDate: "asc" },
    take: 400,
  });
  return lines.map((l) => ({
    transactionId: l.id,
    txnDate: l.txnDate.toISOString().slice(0, 10),
    description: l.description ?? "(no description)",
    amount: round2(Number(l.amount)),
    debit: direction === "DR" ? round2(Number(l.amount)) : 0,
    credit: direction === "CR" ? round2(Number(l.amount)) : 0,
  }));
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
  if (code.startsWith("REV-")) return drillRevenue(code, companyId, start, end, outletId);
  if (code === "PROC") return drillPurchases(companyId, start, end, outletId);
  if (code === "MKT-ADS") return drillAds(start, end);
  if (code === "MKT-GRAB-PROMO") return drillGrabPromo(companyId, start, end, outletId);
  if (code === "MKT-GRAB-ADS") return drillGrabAds(companyId, start, end, outletId);
  if (code.startsWith("BANK:")) return drillBank(code.slice(5), companyId, start, end, outletId);
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
