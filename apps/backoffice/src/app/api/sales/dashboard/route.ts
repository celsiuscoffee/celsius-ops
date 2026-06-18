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
  isWeekend,
  getBlendedTarget,
  getBlendedDeliveryTarget,
  type ChannelBreakdown,
  type ChannelData,
  emptyChannelData,
  addToChannel,
  roundChannel,
  roundChannelData,
} from "../_lib/storehub-helpers";
import { getUnifiedSalesForOutlet, type UnifiedSale } from "../_lib/unified-sales";
import { getActiveTargets } from "../_lib/targets";
import { startOfWeekMYT, startOfMonthMYT } from "@celsius/shared";

// ─── GET /api/sales/dashboard ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const outletId = searchParams.get("outletId") || null;
    const period = searchParams.get("period") || "daily"; // daily | weekly | monthly | custom | yesterday | last7days | last30days
    const paramFrom = searchParams.get("from");
    const paramTo = searchParams.get("to");

    // Determine date range (MYT)
    const now = new Date();
    const mytNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayMYT = mytNow.toISOString().split("T")[0];

    let fromDate: string;
    let toDate: string;

    if (period === "custom" && paramFrom && paramTo) {
      fromDate = paramFrom;
      toDate = paramTo;
    } else if (period === "yesterday") {
      const d = new Date(mytNow);
      d.setDate(d.getDate() - 1);
      const yesterdayMYT = d.toISOString().split("T")[0];
      fromDate = yesterdayMYT;
      toDate = yesterdayMYT;
    } else if (period === "last7days") {
      const d = new Date(mytNow);
      d.setDate(d.getDate() - 6);
      fromDate = d.toISOString().split("T")[0];
      toDate = todayMYT;
    } else if (period === "last30days") {
      const d = new Date(mytNow);
      d.setDate(d.getDate() - 29);
      fromDate = d.toISOString().split("T")[0];
      toDate = todayMYT;
    } else if (period === "weekly") {
      // Calendar week to date (Sunday-start, MYT) — shared definition so the
      // headline, the comparison chart, and the staff app all mean the same
      // "this week". (Was a trailing-7-day window, which disagreed with both.)
      fromDate = startOfWeekMYT(todayMYT);
      toDate = todayMYT;
    } else if (period === "monthly") {
      // Calendar month to date (MYT).
      fromDate = startOfMonthMYT(todayMYT);
      toDate = todayMYT;
    } else {
      // daily — today only
      fromDate = todayMYT;
      toDate = todayMYT;
    }

    // Calculate previous period for comparison
    // Use noon to avoid rounding issues with midnight boundaries
    const fromD = new Date(fromDate + "T12:00:00+08:00");
    const toD = new Date(toDate + "T12:00:00+08:00");
    const periodDays = Math.round((toD.getTime() - fromD.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const prevToD = new Date(fromD);
    prevToD.setDate(prevToD.getDate() - 1);
    const prevFromD = new Date(prevToD);
    prevFromD.setDate(prevFromD.getDate() - periodDays + 1);
    const prevFromMYT = new Date(prevFromD.getTime() + 8 * 60 * 60 * 1000);
    const prevToMYT = new Date(prevToD.getTime() + 8 * 60 * 60 * 1000);
    const prevFromDate = prevFromMYT.toISOString().split("T")[0];
    const prevToDate = prevToMYT.toISOString().split("T")[0];

    // Like-for-like ("realtime") comparison: when the current period is still
    // in progress (it runs up to today), the previous period must be measured
    // to the SAME elapsed point — otherwise a partial day/week/month reads as a
    // huge drop against the prior FULL one (e.g. today-so-far vs all of
    // yesterday → "-70%"). Shifting `now` back exactly periodDays reproduces the
    // same time-of-day / weekday offset the chart's running-total already uses,
    // so the headline deltas match the Today-vs-Yesterday curve.
    const inProgress = toDate === todayMYT;
    const prevCutoffMs = now.getTime() - periodDays * 24 * 60 * 60 * 1000;

    // Fetch outlets
    const outletWhere = outletId
      ? { id: outletId, storehubId: { not: null } }
      : { storehubId: { not: null }, status: "ACTIVE" as const };

    const outlets = await prisma.outlet.findMany({
      where: outletWhere,
      select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
    });

    if (outlets.length === 0) {
      return NextResponse.json({ error: "No outlets with StoreHub configured" }, { status: 404 });
    }

    // Load active (AI-set) targets — used for per-round % calculations and day cells
    const { targets: activeTargets, meta: targetsMeta } = await getActiveTargets();

    // Pull each outlet's sales from the unified source — StoreHub archive before
    // the outlet's cutover, pos_orders after. No live StoreHub API. Covers the
    // current + previous period; split by date below.
    const allSales: UnifiedSale[] = [];
    const prevSales: UnifiedSale[] = [];
    const warnings: string[] = [];
    // Track delivery/QR separately (not excluded, just tracked)
    let deliveryQRRevenue = 0;
    let deliveryQROrders = 0;
    let prevDeliveryQRRevenue = 0;
    let prevDeliveryQROrders = 0;
    const channelBreakdown: Record<string, { count: number; revenue: number }> = {};

    const from = new Date(prevFromDate + "T00:00:00+08:00");
    const to = new Date(toDate + "T23:59:59+08:00");

    const outletResults = await Promise.allSettled(
      outlets.map(async (outlet) => {
        const sales = await getUnifiedSalesForOutlet(
          { outletId: outlet.id, storehubStoreId: outlet.storehubId, loyaltyOutletId: outlet.loyaltyOutletId, pickupStoreId: outlet.pickupStoreId, cutoverAt: outlet.posNativeCutoverAt },
          from,
          to,
        );
        return { outlet, sales };
      }),
    );

    for (const result of outletResults) {
      if (result.status === "rejected") {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`[sales/dashboard] Failed to load outlet sales:`, msg);
        warnings.push(msg);
        continue;
      }

      for (const ev of result.value.sales) {
        const dateStr = getMYTDateStr(ev.ts);

        // Track channel breakdown
        const ch = ev.channelLabel || "(direct)";
        if (!channelBreakdown[ch]) channelBreakdown[ch] = { count: 0, revenue: 0 };
        channelBreakdown[ch].count++;
        channelBreakdown[ch].revenue = Math.round((channelBreakdown[ch].revenue + ev.total) * 100) / 100;

        if (dateStr >= fromDate && dateStr <= toDate) {
          allSales.push(ev);
          if (ev.isDeliveryQR) {
            deliveryQRRevenue += ev.total;
            deliveryQROrders++;
          }
        } else if (
          dateStr >= prevFromDate && dateStr <= prevToDate &&
          // Cap the previous period at the same elapsed point when the current
          // one is still running, so the comparison is to-now vs to-now.
          (!inProgress || new Date(ev.ts).getTime() <= prevCutoffMs)
        ) {
          prevSales.push(ev);
          if (ev.isDeliveryQR) {
            prevDeliveryQRRevenue += ev.total;
            prevDeliveryQROrders++;
          }
        }
      }
    }

    // Previous period totals for comparison
    let prevRevenue = 0;
    let prevOrders = 0;
    const prevChannels = { dine_in: { revenue: 0, orders: 0 }, takeaway: { revenue: 0, orders: 0 }, delivery: { revenue: 0, orders: 0 } };
    for (const ev of prevSales) {
      prevRevenue += ev.total;
      prevOrders += 1;
      prevChannels[ev.channel].revenue += ev.total;
      prevChannels[ev.channel].orders += 1;
    }

    // Build date range
    const dates = getDateRange(fromDate, toDate);

    // Initialize data structure: round -> date -> { revenue, orders, channels }
    type CellData = { revenue: number; orders: number; channels: ChannelData };
    const grid: Record<RoundKey, Record<string, CellData>> = {} as Record<RoundKey, Record<string, CellData>>;
    for (const r of ROUNDS) {
      grid[r.key] = {};
      for (const d of dates) {
        grid[r.key][d] = { revenue: 0, orders: 0, channels: emptyChannelData() };
      }
    }

    // Also track outside-round transactions
    let outsideRoundRevenue = 0;
    let outsideRoundOrders = 0;

    // Process sales — each unified sale is one order
    for (const ev of allSales) {
      const hour = getMYTHour(ev.ts);
      const dateStr = getMYTDateStr(ev.ts);
      const round = getRound(hour);

      if (!round || !dates.includes(dateStr)) {
        if (dates.includes(dateStr)) {
          outsideRoundRevenue += ev.total;
          outsideRoundOrders++;
        }
        continue;
      }

      grid[round][dateStr].revenue += ev.total;
      grid[round][dateStr].orders += 1;
      addToChannel(grid[round][dateStr].channels, ev.channel, ev.total);
    }

    // Build response
    const roundsData = ROUNDS.map((r) => {
      const dailyData = dates.map((d) => {
        const cell = grid[r.key][d];
        const rounded = roundChannelData(cell.channels);
        return {
          date: d,
          revenue: Math.round(cell.revenue * 100) / 100,
          orders: cell.orders,
          aov: cell.orders > 0 ? Math.round((cell.revenue / cell.orders) * 100) / 100 : 0,
          dineIn: rounded.dineIn,
          takeaway: rounded.takeaway,
          delivery: rounded.delivery,
        };
      });

      const totalRevenue = dailyData.reduce((s, d) => s + d.revenue, 0);
      const totalOrders = dailyData.reduce((s, d) => s + d.orders, 0);
      const daysWithData = dailyData.filter((d) => d.orders > 0).length;

      // Aggregate channel totals
      const totalDineIn: ChannelBreakdown = { revenue: 0, orders: 0 };
      const totalTakeaway: ChannelBreakdown = { revenue: 0, orders: 0 };
      const totalDelivery: ChannelBreakdown = { revenue: 0, orders: 0 };
      for (const d of dailyData) {
        totalDineIn.revenue += d.dineIn.revenue;
        totalDineIn.orders += d.dineIn.orders;
        totalTakeaway.revenue += d.takeaway.revenue;
        totalTakeaway.orders += d.takeaway.orders;
        totalDelivery.revenue += d.delivery.revenue;
        totalDelivery.orders += d.delivery.orders;
      }

      // Blended target based on weekday/weekend mix of the date range
      // Targets are per-outlet, so scale by outlet count when viewing multiple
      const outletCount = outlets.length;
      const singleBlended = getBlendedTarget(r.key, dates, activeTargets);
      const blendedTarget = {
        revenue: singleBlended.revenue * outletCount,
        orders: singleBlended.orders * outletCount,
        aov: singleBlended.aov, // AOV doesn't scale — it's per-order
      };

      // pctOfTarget: average daily revenue as % of the round's blended daily target
      let pctOfTarget = 0;
      if (daysWithData > 0 && blendedTarget.revenue > 0) {
        const avgDailyRevenue = totalRevenue / daysWithData;
        pctOfTarget = Math.round((avgDailyRevenue / blendedTarget.revenue) * 100);
      }

      // Per-day targets for daily cells (scaled by outlet count)
      const dailyWithTargets = dailyData.map((d) => {
        const base = isWeekend(d.date) ? activeTargets[r.key].weekend : activeTargets[r.key].weekday;
        const dayTarget = {
          revenue: base.revenue * outletCount,
          orders: base.orders * outletCount,
          aov: base.aov, // AOV doesn't scale
        };
        return { ...d, target: dayTarget };
      });

      return {
        key: r.key,
        label: r.label,
        timeRange: `${r.startH > 12 ? r.startH - 12 : r.startH}${r.startH >= 12 ? "PM" : "AM"}-${r.endH > 12 ? r.endH - 12 : r.endH}${r.endH >= 12 ? "PM" : "AM"}`,
        daily: dailyWithTargets,
        totals: {
          revenue: Math.round(totalRevenue * 100) / 100,
          orders: totalOrders,
          aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
          dineIn: roundChannel(totalDineIn),
          takeaway: roundChannel(totalTakeaway),
          delivery: roundChannel(totalDelivery),
          pctOfTarget,
        },
        averages: {
          revenue: daysWithData > 0 ? Math.round((totalRevenue / daysWithData) * 100) / 100 : 0,
          orders: daysWithData > 0 ? Math.round((totalOrders / daysWithData) * 100) / 100 : 0,
          aov:
            daysWithData > 0
              ? Math.round(
                  (dailyData.filter((d) => d.orders > 0).reduce((s, d) => s + d.aov, 0) /
                    daysWithData) *
                    100,
                ) / 100
              : 0,
          dineIn: daysWithData > 0
            ? roundChannel({ revenue: totalDineIn.revenue / daysWithData, orders: totalDineIn.orders / daysWithData })
            : { revenue: 0, orders: 0 },
          takeaway: daysWithData > 0
            ? roundChannel({ revenue: totalTakeaway.revenue / daysWithData, orders: totalTakeaway.orders / daysWithData })
            : { revenue: 0, orders: 0 },
          delivery: daysWithData > 0
            ? roundChannel({ revenue: totalDelivery.revenue / daysWithData, orders: totalDelivery.orders / daysWithData })
            : { revenue: 0, orders: 0 },
        },
        target: blendedTarget,
      };
    });

    // Summary totals
    const totalRevenue = roundsData.reduce((s, r) => s + r.totals.revenue, 0) + outsideRoundRevenue;
    const totalOrders = roundsData.reduce((s, r) => s + r.totals.orders, 0) + outsideRoundOrders;

    // All outlets for dropdown
    const allOutlets = await prisma.outlet.findMany({
      where: { storehubId: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    // Previous period comparison
    const prevAov = prevOrders > 0 ? Math.round((prevRevenue / prevOrders) * 100) / 100 : 0;
    const prevTakeawayRev = prevChannels.takeaway.revenue + prevChannels.delivery.revenue;
    const prevTakeawayOrd = prevChannels.takeaway.orders + prevChannels.delivery.orders;

    return NextResponse.json({
      period: { from: fromDate, to: toDate, type: period },
      dates,
      summary: {
        revenue: Math.round(totalRevenue * 100) / 100,
        orders: totalOrders,
        aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
        ownSalesRevenue: Math.round((totalRevenue - deliveryQRRevenue) * 100) / 100,
        ownSalesOrders: totalOrders - deliveryQROrders,
      },
      previous: {
        revenue: Math.round(prevRevenue * 100) / 100,
        orders: prevOrders,
        aov: prevAov,
        takeaway: { revenue: Math.round(prevChannels.takeaway.revenue * 100) / 100, orders: prevChannels.takeaway.orders },
        delivery: { revenue: Math.round(prevChannels.delivery.revenue * 100) / 100, orders: prevChannels.delivery.orders },
        pickupDeliveryRevenue: Math.round(prevTakeawayRev * 100) / 100,
        pickupDeliveryOrders: prevTakeawayOrd,
        periodFrom: prevFromDate,
        periodTo: prevToDate,
        // true = previous period was capped to the same elapsed point (the
        // current period is still running), so deltas are a like-for-like
        // to-now comparison. The page labels it accordingly.
        sameTime: inProgress,
      },
      rounds: roundsData,
      outsideRounds: {
        revenue: Math.round(outsideRoundRevenue * 100) / 100,
        orders: outsideRoundOrders,
      },
      deliveryTarget: (() => {
        const base = getBlendedDeliveryTarget(dates);
        const oc = outlets.length;
        return { revenue: base.revenue * oc, orders: base.orders * oc, aov: base.aov };
      })(),
      deliveryQR: {
        revenue: Math.round(deliveryQRRevenue * 100) / 100,
        orders: deliveryQROrders,
      },
      channelBreakdown,
      availableOutlets: allOutlets,
      targetsMeta,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    console.error("[sales/dashboard] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
