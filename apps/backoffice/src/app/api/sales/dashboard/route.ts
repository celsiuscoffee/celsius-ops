import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTransactions, type StoreHubTransaction } from "@/lib/storehub";

// ─── Time Rounds (MYT = UTC+8) ──────────────────────────────────────────

const ROUNDS = [
  { key: "breakfast", label: "Breakfast", startH: 8, endH: 10 },
  { key: "brunch", label: "Brunch", startH: 10, endH: 12 },
  { key: "lunch", label: "Lunch", startH: 12, endH: 15 },
  { key: "midday", label: "Midday", startH: 15, endH: 17 },
  { key: "evening", label: "Evening", startH: 17, endH: 19 },
  { key: "dinner", label: "Dinner", startH: 19, endH: 21 },
  { key: "supper", label: "Supper", startH: 21, endH: 23 },
] as const;

type RoundKey = (typeof ROUNDS)[number]["key"];

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Convert a timestamp string to MYT hours (0-23) */
function getMYTHour(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return -1;
  // If the string has no timezone indicator, assume it's already MYT
  const isUTC = /Z|[+-]\d{2}:\d{2}$/.test(dateStr);
  if (isUTC) {
    const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return myt.getUTCHours();
  }
  return d.getUTCHours();
}

/** Get MYT date string (YYYY-MM-DD) from a timestamp */
function getMYTDateStr(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "unknown";
  const isUTC = /Z|[+-]\d{2}:\d{2}$/.test(dateStr);
  if (isUTC) {
    const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return myt.toISOString().split("T")[0];
  }
  return d.toISOString().split("T")[0];
}

/** Which round does this hour fall into? */
function getRound(hour: number): RoundKey | null {
  for (const r of ROUNDS) {
    if (hour >= r.startH && hour < r.endH) return r.key;
  }
  return null;
}

/** Generate array of date strings between from and to (inclusive) */
function getDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(from + "T00:00:00+08:00");
  const end = new Date(to + "T00:00:00+08:00");
  const cur = new Date(start);
  while (cur <= end) {
    // Add +8h to get MYT before extracting the date string
    const myt = new Date(cur.getTime() + 8 * 60 * 60 * 1000);
    dates.push(myt.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Detect delivery platform or QR table order */
function isDeliveryOrQR(txn: StoreHubTransaction): boolean {
  const hints: string[] = [];
  if (txn.channel) hints.push(txn.channel.toLowerCase().trim());
  if (txn.remarks) hints.push(txn.remarks.toLowerCase().trim());
  if (txn.orderType) hints.push(txn.orderType.toLowerCase().trim());
  const combined = hints.join(" ");
  return /\b(delivery|grab|grabfood|foodpanda|shopee|shopeefood)\b/.test(combined) ||
    /\b(qr[\s_-]?table|qr[\s_-]?order|qrtable)\b/.test(combined) ||
    hints.some((h) => h === "qr");
}

/** Classify a StoreHub transaction into dine_in | takeaway | delivery.
 *  Checks channel, remarks, orderType, and tags fields. */
function classifyChannel(txn: StoreHubTransaction): "dine_in" | "takeaway" | "delivery" {
  // Collect all text hints from the transaction
  const hints: string[] = [];
  if (txn.channel) hints.push(txn.channel.toLowerCase().trim());
  if (txn.remarks) hints.push(txn.remarks.toLowerCase().trim());
  if (txn.orderType) hints.push(txn.orderType.toLowerCase().trim());
  if (txn.tags) {
    for (const tag of txn.tags) hints.push(tag.toLowerCase().trim());
  }

  const combined = hints.join(" ");

  // Delivery platforms
  if (/\b(grab|grabfood|foodpanda|shopee|shopeefood)\b/.test(combined)) return "delivery";
  if (/\bdelivery\b/.test(combined)) return "delivery";

  // Takeaway — check for "takeaway", "take away", "take-away", "ta", "tapau", "dabao"
  if (/\b(takeaway|take[\s-]?away|tapau|dabao|bungkus)\b/.test(combined)) return "takeaway";
  // Short form "TA" only if it's the entire channel/remarks (not substring)
  for (const h of hints) {
    if (h === "ta") return "takeaway";
  }

  // Dine-in explicit
  if (/\b(dine[\s-]?in|dinein)\b/.test(combined)) return "dine_in";

  return "dine_in";
}

// Targets per round from spreadsheet — weekday vs weekend
type RoundTarget = {
  weekday: { revenue: number; orders: number; aov: number };
  weekend: { revenue: number; orders: number; aov: number };
};

const ROUND_TARGETS: Record<RoundKey, RoundTarget> = {
  breakfast: { weekday: { revenue: 400, orders: 20, aov: 20 }, weekend: { revenue: 525, orders: 15, aov: 35 } },
  brunch:    { weekday: { revenue: 400, orders: 20, aov: 20 }, weekend: { revenue: 525, orders: 15, aov: 35 } },
  lunch:     { weekday: { revenue: 450, orders: 15, aov: 30 }, weekend: { revenue: 700, orders: 20, aov: 35 } },
  midday:    { weekday: { revenue: 450, orders: 15, aov: 30 }, weekend: { revenue: 350, orders: 10, aov: 35 } },
  evening:   { weekday: { revenue: 600, orders: 20, aov: 30 }, weekend: { revenue: 700, orders: 20, aov: 35 } },
  dinner:    { weekday: { revenue: 600, orders: 20, aov: 30 }, weekend: { revenue: 700, orders: 20, aov: 35 } },
  supper:    { weekday: { revenue: 375, orders: 15, aov: 25 }, weekend: { revenue: 450, orders: 15, aov: 30 } },
};

// Delivery/Pickup targets
const DELIVERY_TARGETS = {
  weekday: { revenue: 525, orders: 15, aov: 35 },
  weekend: { revenue: 525, orders: 15, aov: 15 },
};

/** Is a date string (YYYY-MM-DD) a weekend (Sat=6, Sun=0)? */
function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00+08:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

/** Get blended target for a round across a set of dates */
function getBlendedTarget(roundKey: RoundKey, dates: string[]): { revenue: number; orders: number; aov: number } {
  if (dates.length === 0) return { revenue: 0, orders: 0, aov: 0 };
  let totalRev = 0, totalOrd = 0, totalAov = 0;
  for (const d of dates) {
    const t = isWeekend(d) ? ROUND_TARGETS[roundKey].weekend : ROUND_TARGETS[roundKey].weekday;
    totalRev += t.revenue;
    totalOrd += t.orders;
    totalAov += t.aov;
  }
  return {
    revenue: Math.round(totalRev / dates.length),
    orders: Math.round(totalOrd / dates.length),
    aov: Math.round((totalAov / dates.length) * 100) / 100,
  };
}

function getBlendedDeliveryTarget(dates: string[]): { revenue: number; orders: number; aov: number } {
  if (dates.length === 0) return { revenue: 0, orders: 0, aov: 0 };
  let totalRev = 0, totalOrd = 0, totalAov = 0;
  for (const d of dates) {
    const t = isWeekend(d) ? DELIVERY_TARGETS.weekend : DELIVERY_TARGETS.weekday;
    totalRev += t.revenue;
    totalOrd += t.orders;
    totalAov += t.aov;
  }
  return {
    revenue: Math.round(totalRev / dates.length),
    orders: Math.round(totalOrd / dates.length),
    aov: Math.round((totalAov / dates.length) * 100) / 100,
  };
}

// ─── Channel breakdown type ─────────────────────────────────────────────

type ChannelBreakdown = {
  revenue: number;
  orders: number;
};

type ChannelData = {
  dineIn: ChannelBreakdown;
  takeaway: ChannelBreakdown;
  delivery: ChannelBreakdown;
};

function emptyChannelData(): ChannelData {
  return {
    dineIn: { revenue: 0, orders: 0 },
    takeaway: { revenue: 0, orders: 0 },
    delivery: { revenue: 0, orders: 0 },
  };
}

function addToChannel(data: ChannelData, channel: "dine_in" | "takeaway" | "delivery", revenue: number) {
  if (channel === "dine_in") {
    data.dineIn.revenue += revenue;
    data.dineIn.orders += 1;
  } else if (channel === "takeaway") {
    data.takeaway.revenue += revenue;
    data.takeaway.orders += 1;
  } else {
    data.delivery.revenue += revenue;
    data.delivery.orders += 1;
  }
}

function roundChannel(ch: ChannelBreakdown): ChannelBreakdown {
  return {
    revenue: Math.round(ch.revenue * 100) / 100,
    orders: ch.orders,
  };
}

function roundChannelData(data: ChannelData): ChannelData {
  return {
    dineIn: roundChannel(data.dineIn),
    takeaway: roundChannel(data.takeaway),
    delivery: roundChannel(data.delivery),
  };
}

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
    const fromD = new Date(fromDate + "T00:00:00+08:00");
    const toD = new Date(toDate + "T23:59:59+08:00");
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

    for (const outlet of outlets) {
      if (!outlet.storehubId) continue;
      try {
        // Fetch both current and previous period in one wider range
        const from = new Date(prevFromDate + "T00:00:00+08:00");
        const to = new Date(toDate + "T23:59:59+08:00");
        const txns = await getTransactions(outlet.storehubId, from, to);
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[sales/dashboard] Failed to fetch for outlet ${outlet.name}:`, msg);
        warnings.push(`${outlet.name}: ${msg}`);
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
    const grid: Record<RoundKey, Record<string, CellData>> = {} as any;
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
      const singleBlended = getBlendedTarget(r.key, dates);
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
        const base = isWeekend(d.date) ? ROUND_TARGETS[r.key].weekend : ROUND_TARGETS[r.key].weekday;
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
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    console.error("[sales/dashboard] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
