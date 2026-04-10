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
    dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Hardcoded daily targets per round (RM revenue)
const ROUND_TARGETS: Record<RoundKey, number> = {
  breakfast: 200,
  brunch: 350,
  lunch: 500,
  midday: 300,
  evening: 400,
  dinner: 450,
  supper: 200,
};

// ─── GET /api/sales/dashboard ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const outletId = searchParams.get("outletId") || null;
    const period = searchParams.get("period") || "daily"; // daily | weekly | monthly | custom
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

    // Fetch StoreHub transactions for each outlet
    const allTxns: { txn: StoreHubTransaction; outletId: string }[] = [];

    for (const outlet of outlets) {
      if (!outlet.storehubId) continue;
      try {
        const from = new Date(fromDate + "T00:00:00+08:00");
        const to = new Date(toDate + "T23:59:59+08:00");
        const txns = await getTransactions(outlet.storehubId, from, to);
        for (const txn of txns) {
          // Only include Sale transactions (not refunds, voids, etc.)
          allTxns.push({ txn, outletId: outlet.id });
        }
      } catch (err) {
        console.error(`[sales/dashboard] Failed to fetch for outlet ${outlet.name}:`, err);
      }
    }

    // Build date range
    const dates = getDateRange(fromDate, toDate);

    // Initialize data structure: round -> date -> { revenue, orders }
    type CellData = { revenue: number; orders: number };
    const grid: Record<RoundKey, Record<string, CellData>> = {} as any;
    for (const r of ROUNDS) {
      grid[r.key] = {};
      for (const d of dates) {
        grid[r.key][d] = { revenue: 0, orders: 0 };
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
    }

    // Build response
    const roundsData = ROUNDS.map((r) => {
      const dailyData = dates.map((d) => {
        const cell = grid[r.key][d];
        return {
          date: d,
          revenue: Math.round(cell.revenue * 100) / 100,
          orders: cell.orders,
          aov: cell.orders > 0 ? Math.round((cell.revenue / cell.orders) * 100) / 100 : 0,
        };
      });

      const totalRevenue = dailyData.reduce((s, d) => s + d.revenue, 0);
      const totalOrders = dailyData.reduce((s, d) => s + d.orders, 0);
      const daysWithData = dailyData.filter((d) => d.orders > 0).length;

      return {
        key: r.key,
        label: r.label,
        timeRange: `${r.startH > 12 ? r.startH - 12 : r.startH}${r.startH >= 12 ? "PM" : "AM"}-${r.endH > 12 ? r.endH - 12 : r.endH}${r.endH >= 12 ? "PM" : "AM"}`,
        daily: dailyData,
        totals: {
          revenue: Math.round(totalRevenue * 100) / 100,
          orders: totalOrders,
          aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
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
        },
        target: {
          revenue: ROUND_TARGETS[r.key],
        },
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

    return NextResponse.json({
      period: { from: fromDate, to: toDate, type: period },
      dates,
      summary: {
        revenue: Math.round(totalRevenue * 100) / 100,
        orders: totalOrders,
        aov: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      },
      rounds: roundsData,
      outsideRounds: {
        revenue: Math.round(outsideRoundRevenue * 100) / 100,
        orders: outsideRoundOrders,
      },
      availableOutlets: allOutlets,
    });
  } catch (err) {
    console.error("[sales/dashboard] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
