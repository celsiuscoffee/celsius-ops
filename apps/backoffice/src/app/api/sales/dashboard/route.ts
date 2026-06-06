import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTransactions, type StoreHubTransaction } from "@/lib/storehub";
import {
  ROUNDS,
  type RoundKey,
  getMYTHour,
  getMYTDateStr,
  getRound,
  getDateRange,
  isDeliveryOrQR,
  classifyChannel,
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
import { getActiveTargets } from "../_lib/targets";

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
      // Last 7 days including today
      const d = new Date(mytNow);
      d.setDate(d.getDate() - 6);
      fromDate = d.toISOString().split("T")[0];
      toDate = todayMYT;
    } else if (period === "monthly") {
      // Current month
      const d = new Date(mytNow.getUTCFullYear(), mytNow.getUTCMonth(), 1);
      fromDate = d.toISOString().split("T")[0];
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

    // Fetch outlets
    const outletWhere = outletId
      ? { id: outletId, storehubId: { not: null } }
      : { storehubId: { not: null }, status: "ACTIVE" as const };

    const outlets = await prisma.outlet.findMany({
      where: outletWhere,
      select: { id: true, name: true, storehubId: true },
    });

    if (outlets.length === 0) {
      return NextResponse.json({ error: "No outlets with StoreHub configured" }, { status: 404 });
    }

    // Load active (AI-set) targets — used for per-round % calculations and day cells
    const { targets: activeTargets, meta: targetsMeta } = await getActiveTargets();

    // Fetch StoreHub transactions for each outlet (current + previous period)
    const allTxns: { txn: StoreHubTransaction; outletId: string }[] = [];
    const prevTxns: StoreHubTransaction[] = [];
    const warnings: string[] = [];
    // Track delivery/QR separately (not excluded, just tracked)
    let deliveryQRRevenue = 0;
    let deliveryQROrders = 0;
    let prevDeliveryQRRevenue = 0;
    let prevDeliveryQROrders = 0;
    const channelBreakdown: Record<string, { count: number; revenue: number }> = {};

    // Fetch all outlets in parallel — each uses a different storeId
    const from = new Date(prevFromDate + "T00:00:00+08:00");
    const to = new Date(toDate + "T23:59:59+08:00");

    const outletResults = await Promise.allSettled(
      outlets
        .filter((o) => o.storehubId)
        .map(async (outlet) => {
          const txns = await getTransactions(outlet.storehubId!, from, to);
          return { outlet, txns };
        }),
    );

    for (const result of outletResults) {
      if (result.status === "rejected") {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`[sales/dashboard] Failed to fetch outlet:`, msg);
        warnings.push(msg);
        continue;
      }

      const { outlet, txns } = result.value;
      for (const txn of txns) {
        const ts = txn.transactionTime || txn.completedAt || txn.createdAt;
        if (!ts) continue;
        const dateStr = getMYTDateStr(ts);

        // Track channel breakdown
        const ch = txn.channel || "(direct)";
        if (!channelBreakdown[ch]) channelBreakdown[ch] = { count: 0, revenue: 0 };
        channelBreakdown[ch].count++;
        channelBreakdown[ch].revenue = Math.round((channelBreakdown[ch].revenue + txn.total) * 100) / 100;

        if (dateStr >= fromDate && dateStr <= toDate) {
          allTxns.push({ txn, outletId: outlet.id });
          if (isDeliveryOrQR(txn)) {
            deliveryQRRevenue += txn.total;
            deliveryQROrders++;
          }
        } else if (dateStr >= prevFromDate && dateStr <= prevToDate) {
          prevTxns.push(txn);
          if (isDeliveryOrQR(txn)) {
            prevDeliveryQRRevenue += txn.total;
            prevDeliveryQROrders++;
          }
        }
      }
    }

    // Previous period totals for comparison
    let prevRevenue = 0;
    let prevOrders = 0;
    const prevChannels = { dine_in: { revenue: 0, orders: 0 }, takeaway: { revenue: 0, orders: 0 }, delivery: { revenue: 0, orders: 0 } };
    for (const txn of prevTxns) {
      prevRevenue += txn.total;
      prevOrders += 1;
      const ch = classifyChannel(txn);
      prevChannels[ch].revenue += txn.total;
      prevChannels[ch].orders += 1;
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

    // Process transactions — each transaction is one order
    for (const { txn } of allTxns) {
      const ts = txn.transactionTime || txn.completedAt || txn.createdAt;
      if (!ts) continue;

      const hour = getMYTHour(ts);
      const dateStr = getMYTDateStr(ts);
      const round = getRound(hour);

      if (!round || !dates.includes(dateStr)) {
        if (dates.includes(dateStr)) {
          outsideRoundRevenue += txn.total;
          outsideRoundOrders++;
        }
        continue;
      }

      grid[round][dateStr].revenue += txn.total;
      grid[round][dateStr].orders += 1;

      const channelType = classifyChannel(txn);
      addToChannel(grid[round][dateStr].channels, channelType, txn.total);
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
