// Count-anchored on-hand VALUE — the keystone that makes inventory value real.
//
// StockBalance only ever increments (it never depletes for sales), so it is
// fiction. This computes a trustworthy inventory value per outlet by anchoring
// on the last usable full stock count and rolling it forward:
//
//   on-hand value = last count (at cost)
//                 + purchases since         (procurement invoices)
//                 − consumption since       (sales × recipes at cost)
//                 − wastage since           (recorded WASTAGE at cost)
//                 + transfers in − transfers out   (at cost)
//
// It reuses the exact valuation primitives the COGS roll-forward uses
// (costPerBaseUnit, evaluateCount), so a count that is too partial/corrupt to
// value COGS also can't anchor on-hand, no fiction leaks in. Outlets with no
// usable count return onHandValue=null (an actionable "go count" signal), not
// a guessed number.
//
// It also SUGGESTS a ceiling: a healthy total inventory is a small number of
// days of consumption. suggestedCeiling = daily consumption × TARGET_DAYS_COVER.

import { prisma } from "@/lib/prisma";
import { costPerBaseUnit, evaluateCount, type CostMaps } from "@/lib/finance/reports/pnl-sourced";
import { buildByCategory, type OutletPick } from "@/app/api/sales/_lib/reports";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Suggested total inventory ceiling, in days of COGS. A café's mix of
// perishables (days) and dry goods (weeks) sits comfortably around two weeks
// of cover; above this is cash tied up on shelves. Tune per policy.
export const TARGET_DAYS_COVER = 14;
const CONSUMPTION_TRAIL_DAYS = 28; // window for the daily-consumption run-rate

export type OnHandValue = {
  outletId: string;
  outletName: string;
  anchorDate: string | null;   // last usable count; null = no anchor
  anchorAgeDays: number | null; // how stale the anchor is (roll-forward error grows with it)
  anchorValue: number;
  purchases: number;
  consumption: number;
  wastage: number;
  transfersIn: number;
  transfersOut: number;
  onHandValue: number | null;  // null when there is no usable count to anchor on
  dailyConsumption: number;    // trailing run-rate
  daysCover: number | null;    // onHandValue / dailyConsumption
  suggestedCeiling: number;    // dailyConsumption × TARGET_DAYS_COVER
  note: string;
};

// Most recent count that passes the same quality gate the COGS engine uses.
async function lastUsableCount(outletId: string, cost: CostMaps): Promise<{ date: Date; value: number } | null> {
  const counts = await prisma.stockCount.findMany({
    where: { outletId, status: { in: ["REVIEWED", "SUBMITTED"] } },
    orderBy: { countDate: "desc" },
    take: 6,
    select: { countDate: true, items: { select: { productId: true, productPackageId: true, countedQty: true } } },
  });
  for (const c of counts) {
    const ok = evaluateCount(c.items, cost);
    if (ok) return { date: c.countDate, value: ok.value };
  }
  return null;
}

// Net transfer value across the outlet boundary in a window, at supplier cost.
async function transferValue(outletId: string, from: Date, to: Date, cost: CostMaps): Promise<{ in: number; out: number }> {
  const items = await prisma.stockTransferItem.findMany({
    where: {
      transfer: {
        status: { in: ["RECEIVED", "COMPLETED"] },
        OR: [
          { toOutletId: outletId, receivedAt: { gte: from, lte: to } },
          { fromOutletId: outletId, createdAt: { gte: from, lte: to } },
        ],
      },
    },
    select: { productId: true, productPackageId: true, quantity: true, transfer: { select: { fromOutletId: true, toOutletId: true } } },
  });
  let tin = 0, tout = 0;
  for (const it of items) {
    const unit = it.productPackageId ? cost.byPackage.get(it.productPackageId) : cost.byBase.get(it.productId);
    if (unit == null) continue;
    const v = Number(it.quantity) * unit;
    if (it.transfer.toOutletId === outletId) tin += v; else tout += v;
  }
  return { in: round2(tin), out: round2(tout) };
}

export async function outletOnHandValue(outlet: OutletPick, cost: CostMaps): Promise<OnHandValue> {
  const now = new Date();
  const trailFrom = new Date(now.getTime() - CONSUMPTION_TRAIL_DAYS * 86_400_000);

  const [anchor, trailCat] = await Promise.all([
    lastUsableCount(outlet.id, cost),
    buildByCategory([outlet], ymd(trailFrom), ymd(now)),
  ]);
  const dailyConsumption = round2((Number(trailCat.total?.cogs) || 0) / CONSUMPTION_TRAIL_DAYS);
  const suggestedCeiling = round2(dailyConsumption * TARGET_DAYS_COVER);

  const base = {
    outletId: outlet.id, outletName: outlet.name,
    dailyConsumption, suggestedCeiling,
    anchorValue: 0, purchases: 0, consumption: 0, wastage: 0, transfersIn: 0, transfersOut: 0,
  };

  if (!anchor) {
    return {
      ...base, anchorDate: null, anchorAgeDays: null, onHandValue: null, daysCover: null,
      note: dailyConsumption > 0
        ? "No usable full count to anchor on-hand value. Run a full count to value inventory."
        : "No recipe consumption (consignment / no sales) and no usable count.",
    };
  }

  const [invAgg, sinceCat, wasteAgg, xfer] = await Promise.all([
    prisma.invoice.aggregate({ _sum: { amount: true }, where: { outletId: outlet.id, issueDate: { gte: anchor.date, lte: now } } }),
    buildByCategory([outlet], ymd(anchor.date), ymd(now)),
    prisma.stockAdjustment.aggregate({ _sum: { costAmount: true }, where: { outletId: outlet.id, adjustmentType: "WASTAGE", createdAt: { gte: anchor.date, lte: now } } }),
    transferValue(outlet.id, anchor.date, now, cost),
  ]);
  const purchases = round2(Number(invAgg._sum?.amount ?? 0));
  const consumption = round2(Number(sinceCat.total?.cogs) || 0);
  const wastage = round2(Number(wasteAgg._sum?.costAmount ?? 0));
  const onHandValue = round2(anchor.value + purchases - consumption - wastage + xfer.in - xfer.out);
  const daysCover = dailyConsumption > 0 ? round2(onHandValue / dailyConsumption) : null;
  const anchorAgeDays = Math.round((now.getTime() - anchor.date.getTime()) / 86_400_000);

  return {
    ...base,
    anchorDate: ymd(anchor.date),
    anchorAgeDays,
    anchorValue: anchor.value,
    purchases, consumption, wastage,
    transfersIn: xfer.in, transfersOut: xfer.out,
    onHandValue,
    daysCover,
    note: anchorAgeDays > 40
      ? `Anchored on a stale ${ymd(anchor.date)} count (${anchorAgeDays} days ago); wide estimate, count to tighten.`
      : `Anchored on the ${ymd(anchor.date)} count, rolled forward.`,
  };
}

// All active outlets, valued. Loads the cost maps once and reuses them.
export async function allOutletsOnHandValue(): Promise<OnHandValue[]> {
  const cost = await costPerBaseUnit();
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
  });
  return Promise.all(outlets.map((o) => outletOnHandValue(o as OutletPick, cost)));
}
