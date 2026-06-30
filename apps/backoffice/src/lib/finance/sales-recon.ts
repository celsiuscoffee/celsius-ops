// Cash-IN reconciliation — the RECONCILE box of the finance loop.
//
// Ties what the POS rang up (gross sales, the cutover-aware unified source) to
// what actually landed in the bank (settlements, the classified sales-inflow
// categories). The gap is fees + platform commission + cash-not-deposited +
// settlement timing — and the loop's job is to make sure that gap is EXPLAINED,
// flagging any channel where money rung up never arrived.
//
// v1 is period-level per channel; per-day settlement-date matching and the
// full Card/QR/Revenue-Monster tender split are refinements (the sales source
// gives fulfilment channel, not tender). Grab is the high-value case: gross
// sales vs net payout exposes the commission+marketing taken at source.

import { prisma } from "@/lib/prisma";
import { getUnifiedSalesForOutlet } from "@/app/api/sales/_lib/unified-sales";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const SALES_INFLOW = ["CARD", "QR", "STOREHUB", "GRAB", "GRAB_PUTRAJAYA", "FOODPANDA", "MEETINGS_EVENTS", "GASTROHUB", "REVENUE_MONSTER"] as const;

export type CashInRecon = {
  from: string; to: string;
  settlementsByChannel: { channel: string; amount: number; n: number }[];
  settlementsTotal: number;
  salesGross: number;
  salesByChannel: { channel: string; amount: number }[];
  gap: number;            // sales − settlements (fees/commission/cash/timing)
  gapPct: number | null;
  grab: { gross: number; settled: number; deductionPct: number | null }; // commission+marketing taken at source
};

export async function cashInRecon(opts: { sinceDays?: number } = {}): Promise<CashInRecon> {
  const sinceDays = opts.sinceDays ?? 30;
  const to = new Date();
  const from = new Date(to.getTime() - sinceDays * 86400_000);

  // ── Settlements: classified sales-inflow bank credits in the window ──
  const grouped = await prisma.bankStatementLine.groupBy({
    by: ["category"],
    where: { direction: "CR", isInterCo: false, txnDate: { gte: from, lte: to }, category: { in: SALES_INFLOW as unknown as never[] } },
    _sum: { amount: true }, _count: true,
  });
  const settlementsByChannel = grouped
    .map((g) => ({ channel: String(g.category), amount: round2(Number(g._sum?.amount ?? 0)), n: g._count }))
    .filter((s) => s.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const settlementsTotal = round2(settlementsByChannel.reduce((s, c) => s + c.amount, 0));
  const grabSettled = round2(settlementsByChannel.filter((c) => c.channel.startsWith("GRAB")).reduce((s, c) => s + c.amount, 0));

  // ── Sales: gross rung up across all outlets (cutover-aware) ──
  const outlets = await prisma.outlet.findMany({
    where: { OR: [{ loyaltyOutletId: { not: null } }, { pickupStoreId: { not: null } }] },
    select: { id: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
  });
  const perOutlet = await Promise.all(
    outlets.map((o) =>
      getUnifiedSalesForOutlet({ outletId: o.id, storehubStoreId: null, loyaltyOutletId: o.loyaltyOutletId, pickupStoreId: o.pickupStoreId, cutoverAt: o.posNativeCutoverAt }, from, to),
    ),
  );
  const sales = { instore: 0, online: 0, grab: 0, foodpanda: 0 };
  for (const list of perOutlet) {
    for (const s of list) {
      const lbl = (s.channelLabel ?? "").toLowerCase();
      if (/grab/.test(lbl)) sales.grab += s.total;
      else if (/panda/.test(lbl)) sales.foodpanda += s.total;
      else if (s.isDeliveryQR || s.channel === "delivery") sales.online += s.total;
      else sales.instore += s.total;
    }
  }
  const salesGross = round2(sales.instore + sales.online + sales.grab + sales.foodpanda);
  const salesByChannel = [
    { channel: "In-store (card/QR/cash)", amount: round2(sales.instore) },
    { channel: "Online (Revenue Monster)", amount: round2(sales.online) },
    { channel: "GrabFood", amount: round2(sales.grab) },
    { channel: "FoodPanda", amount: round2(sales.foodpanda) },
  ].filter((c) => c.amount > 0);

  const gap = round2(salesGross - settlementsTotal);
  const grabGross = round2(sales.grab);
  return {
    from: ymd(from), to: ymd(to),
    settlementsByChannel, settlementsTotal, salesGross, salesByChannel,
    gap, gapPct: salesGross > 0 ? round2((gap / salesGross) * 100) : null,
    grab: { gross: grabGross, settled: grabSettled, deductionPct: grabGross > 0 ? round2(((grabGross - grabSettled) / grabGross) * 100) : null },
  };
}
