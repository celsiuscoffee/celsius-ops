import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ROUNDS,
  type RoundKey,
  getMYTHour,
  getMYTDateStr,
  getRound,
  getDateRange,
} from "../sales/_lib/storehub-helpers";
import { getUnifiedSalesForOutlet, type UnifiedSale } from "../sales/_lib/unified-sales";
import { startOfWeekMYT, startOfMonthMYT } from "@celsius/shared";

// ─── GET /api/command ──────────────────────────────────────────────────────
// The Command Center brain. Aggregates the unified sales engine into a single
// payload: company pulse, a per-outlet league, sales-by-round, channel mix,
// and a ranked "needs you now" attention list computed across the signal
// families we can see from sales today (money, pace). Ops serve-time, people
// cost and customer-churn families are wired by the page from their own
// modules as they come online.

const AOV_TARGET = 40; // RM — the business-model AOV target (per memory)

type RoundAgg = { revenue: number; orders: number };
type ChannelAgg = { revenue: number; orders: number };

type OutletKpi = {
  id: string;
  name: string;
  revenue: number;
  orders: number;
  aov: number;
  prevRevenue: number;
  growthPct: number | null;
  periodTarget: number;
  pctOfTarget: number;
  onPace: boolean;
  traded: boolean;
  rounds: Record<RoundKey, RoundAgg>;
};

type Alert = {
  id: string;
  family: "money" | "promise" | "pace" | "customer";
  severity: "high" | "med";
  title: string;
  detail: string;
  impactRM: number;
  href: string;
};

function emptyRounds(): Record<RoundKey, RoundAgg> {
  const r = {} as Record<RoundKey, RoundAgg>;
  for (const round of ROUNDS) r[round.key] = { revenue: 0, orders: 0 };
  return r;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    // today | week | month  (mapped to the same windows the sales dashboard uses)
    const period = searchParams.get("period") || "month";
    // Managers are scoped to their own outlet; owners/admins see all (and may
    // narrow with ?outletId=). An out-of-scope outletId is ignored for managers.
    const requestedOutlet = searchParams.get("outletId");
    const managerOutlet = user.outletId || null;
    const scopeOutletId = managerOutlet || requestedOutlet || null;

    // Date range (MYT) — mirror the sales dashboard so the two always agree.
    const now = new Date();
    const mytNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayMYT = mytNow.toISOString().split("T")[0];

    let fromDate: string;
    const toDate = todayMYT;
    if (period === "today") {
      fromDate = todayMYT;
    } else if (period === "week") {
      fromDate = startOfWeekMYT(todayMYT);
    } else {
      fromDate = startOfMonthMYT(todayMYT);
    }

    // Previous comparable period, capped to the same elapsed point (the current
    // period is always running up to "now").
    const fromD = new Date(fromDate + "T12:00:00+08:00");
    const toD = new Date(toDate + "T12:00:00+08:00");
    const periodDays = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
    const prevToD = new Date(fromD);
    prevToD.setDate(prevToD.getDate() - 1);
    const prevFromD = new Date(prevToD);
    prevFromD.setDate(prevFromD.getDate() - periodDays + 1);
    const prevFromDate = new Date(prevFromD.getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const prevToDate = new Date(prevToD.getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const prevCutoffMs = now.getTime() - periodDays * 86400000;

    const dates = getDateRange(fromDate, toDate);

    // Outlets in scope.
    const outlets = await prisma.outlet.findMany({
      where: scopeOutletId
        ? { id: scopeOutletId }
        : {
            status: "ACTIVE",
            OR: [{ storehubId: { not: null } }, { loyaltyOutletId: { not: null } }],
          },
      select: {
        id: true,
        name: true,
        storehubId: true,
        loyaltyOutletId: true,
        pickupStoreId: true,
        posNativeCutoverAt: true,
      },
      orderBy: { name: "asc" },
    });

    if (outlets.length === 0) {
      return NextResponse.json({ error: "No outlets in scope" }, { status: 404 });
    }

    // Per-outlet monthly sales targets (business model): RM120k default,
    // Putrajaya/Conezion RM140k. Scaled to the selected period — a full month
    // shows the full goal, not a prorated pace figure (operators think monthly).
    const MONTHLY_TARGET_DEFAULT = 120000;
    const MONTHLY_TARGET_OVERRIDES: Record<string, number> = { "outlet-con": 140000 }; // Putrajaya
    const monthlyTargetFor = (o: { loyaltyOutletId: string | null }) =>
      (o.loyaltyOutletId && MONTHLY_TARGET_OVERRIDES[o.loyaltyOutletId]) || MONTHLY_TARGET_DEFAULT;
    const periodTargetFor = (monthly: number) =>
      period === "month" ? monthly
      : period === "week" ? Math.round((monthly * 7) / 30.44)
      : Math.round(monthly / 30.44);
    // paceFraction = how far through the period we are, so "on pace" colouring
    // isn't misleadingly red all month (e.g. 70% of the month elapsed → you'd
    // expect ~70% of the monthly goal banked).
    const daysInMonth = new Date(Date.UTC(mytNow.getUTCFullYear(), mytNow.getUTCMonth() + 1, 0)).getUTCDate();
    const mytHour = mytNow.getUTCHours();
    const paceFraction =
      period === "today" ? Math.min(1, Math.max(0.05, (mytHour - 8) / 14)) // ~8am–10pm trading day
      : period === "week" ? Math.min(1, dates.length / 7)
      : Math.min(1, dates.length / daysInMonth);

    const fetchFrom = new Date(prevFromDate + "T00:00:00+08:00");
    const fetchTo = new Date(toDate + "T23:59:59+08:00");

    const results = await Promise.allSettled(
      outlets.map(async (o) => {
        const sales = await getUnifiedSalesForOutlet(
          {
            outletId: o.id,
            storehubStoreId: o.storehubId,
            loyaltyOutletId: o.loyaltyOutletId,
            pickupStoreId: o.pickupStoreId,
            cutoverAt: o.posNativeCutoverAt,
          },
          fetchFrom,
          fetchTo,
        );
        return { outlet: o, sales };
      }),
    );

    const outletKpis: OutletKpi[] = [];
    const companyChannel: Record<"dine_in" | "takeaway" | "delivery", ChannelAgg> = {
      dine_in: { revenue: 0, orders: 0 },
      takeaway: { revenue: 0, orders: 0 },
      delivery: { revenue: 0, orders: 0 },
    };
    const companyRounds = emptyRounds();

    for (const res of results) {
      if (res.status === "rejected") {
        console.error("[command] outlet load failed:", res.reason);
        continue;
      }
      const { outlet, sales } = res.value;
      let revenue = 0;
      let orders = 0;
      let prevRevenue = 0;
      const rounds = emptyRounds();

      for (const ev of sales as UnifiedSale[]) {
        const dateStr = getMYTDateStr(ev.ts);
        if (dateStr >= fromDate && dateStr <= toDate) {
          revenue += ev.total;
          orders += 1;
          companyChannel[ev.channel].revenue += ev.total;
          companyChannel[ev.channel].orders += 1;
          const round = getRound(getMYTHour(ev.ts));
          if (round) {
            rounds[round].revenue += ev.total;
            rounds[round].orders += 1;
            companyRounds[round].revenue += ev.total;
            companyRounds[round].orders += 1;
          }
        } else if (
          dateStr >= prevFromDate &&
          dateStr <= prevToDate &&
          new Date(ev.ts).getTime() <= prevCutoffMs
        ) {
          prevRevenue += ev.total;
        }
      }

      const traded = orders > 0;
      const periodTarget = periodTargetFor(monthlyTargetFor(outlet));
      const pctOfTarget = periodTarget > 0 ? Math.round((revenue / periodTarget) * 100) : 0;
      const onPace = revenue >= periodTarget * paceFraction;
      const growthPct =
        prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : null;

      outletKpis.push({
        id: outlet.id,
        name: outlet.name,
        revenue: Math.round(revenue),
        orders,
        aov: orders > 0 ? Math.round(revenue / orders) : 0,
        prevRevenue: Math.round(prevRevenue),
        growthPct,
        periodTarget: Math.round(periodTarget),
        pctOfTarget,
        onPace,
        traded,
        rounds,
      });
    }

    // Company aggregate.
    const compRevenue = outletKpis.reduce((s, o) => s + o.revenue, 0);
    const compOrders = outletKpis.reduce((s, o) => s + o.orders, 0);
    const compPrev = outletKpis.reduce((s, o) => s + o.prevRevenue, 0);
    const tradingKpis = outletKpis.filter((o) => o.traded);
    const compTarget = (tradingKpis.length ? tradingKpis : outletKpis).reduce((s, o) => s + o.periodTarget, 0);
    const company = {
      revenue: compRevenue,
      orders: compOrders,
      aov: compOrders > 0 ? Math.round(compRevenue / compOrders) : 0,
      target: compTarget,
      pctOfTarget: compTarget > 0 ? Math.round((compRevenue / compTarget) * 100) : 0,
      onPace: compTarget > 0 && compRevenue >= compTarget * paceFraction,
      prevRevenue: compPrev,
      growthPct: compPrev > 0 ? Math.round(((compRevenue - compPrev) / compPrev) * 100) : null,
      channel: {
        dineIn: companyChannel.dine_in,
        takeaway: companyChannel.takeaway,
        delivery: companyChannel.delivery,
      },
      rounds: ROUNDS.map((r) => ({
        key: r.key,
        label: r.label,
        revenue: Math.round(companyRounds[r.key].revenue),
        orders: companyRounds[r.key].orders,
      })),
    };

    // ── Attention engine ─────────────────────────────────────────────────
    // One alert per signal family we can compute from sales. Ranked by RM.
    const alerts: Alert[] = [];

    // PACE — the outlet tracking furthest behind its target (only meaningful
    // for trading outlets; skip when looking at a single outlet's own view).
    const laggards = outletKpis
      .filter((o) => o.traded && !o.onPace)
      .sort((a, b) => a.pctOfTarget - b.pctOfTarget);
    if (laggards.length > 0) {
      const w = laggards[0];
      const behindBy = Math.round(paceFraction * 100) - w.pctOfTarget;
      alerts.push({
        id: `pace-${w.id}`,
        family: "pace",
        severity: behindBy >= 20 ? "high" : "med",
        title: `${w.name} behind pace — ${w.pctOfTarget}% of its RM ${w.periodTarget.toLocaleString()} target`,
        detail: `RM ${w.revenue.toLocaleString()} of RM ${w.periodTarget.toLocaleString()} this ${period}`,
        impactRM: Math.max(0, w.periodTarget - w.revenue),
        href: `/sales/dashboard?outletId=${w.id}`,
      });
    }

    // MONEY — average order value below the RM40 target drags margin & frequency.
    if (company.aov > 0 && company.aov < AOV_TARGET) {
      const gap = AOV_TARGET - company.aov;
      alerts.push({
        id: "money-aov",
        family: "money",
        severity: gap >= 5 ? "high" : "med",
        title: `Average order RM ${company.aov} — below the RM ${AOV_TARGET} target`,
        detail: `Closing the RM ${gap} gap on ${company.orders.toLocaleString()} orders ≈ RM ${(gap * company.orders).toLocaleString()}`,
        impactRM: gap * company.orders,
        href: "/sales/dashboard",
      });
    }

    alerts.sort((a, b) => b.impactRM - a.impactRM);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      period: { type: period, from: fromDate, to: toDate, days: dates.length },
      scope: scopeOutletId ? "outlet" : "company",
      canSeeAllOutlets: !managerOutlet,
      company,
      outlets: outletKpis.map(({ rounds, ...rest }) => ({
        ...rest,
        rounds: ROUNDS.map((r) => ({ key: r.key, label: r.label, revenue: Math.round(rounds[r.key].revenue) })),
      })),
      alerts,
    });
  } catch (err) {
    console.error("[command] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
