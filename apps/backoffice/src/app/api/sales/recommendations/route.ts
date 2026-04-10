import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTransactions, type StoreHubTransaction } from "@/lib/storehub";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// Weekday targets (used as reference for AI analysis)
const ROUND_TARGETS: Record<string, { weekday: number; weekend: number }> = {
  breakfast: { weekday: 400, weekend: 525 },
  brunch:    { weekday: 400, weekend: 525 },
  lunch:     { weekday: 450, weekend: 700 },
  midday:    { weekday: 450, weekend: 350 },
  evening:   { weekday: 600, weekend: 700 },
  dinner:    { weekday: 600, weekend: 700 },
  supper:    { weekday: 375, weekend: 450 },
};

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00+08:00");
  const day = d.getDay();
  return day === 0 || day === 6;
}

function getAvgTarget(roundKey: string, dates: string[]): number {
  if (dates.length === 0) return 0;
  let total = 0;
  for (const d of dates) {
    total += isWeekend(d) ? ROUND_TARGETS[roundKey].weekend : ROUND_TARGETS[roundKey].weekday;
  }
  return Math.round(total / dates.length);
}

function getMYTHour(dateStr: string): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return -1;
  const isUTC = /Z|[+-]\d{2}:\d{2}$/.test(dateStr);
  if (isUTC) {
    const myt = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return myt.getUTCHours();
  }
  return d.getUTCHours();
}

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

function getRoundKey(hour: number): string | null {
  for (const r of ROUNDS) {
    if (hour >= r.startH && hour < r.endH) return r.key;
  }
  return null;
}

function classifyChannel(channel?: string | null): "dine_in" | "takeaway" | "delivery" {
  if (!channel) return "dine_in";
  const lower = channel.toLowerCase().trim();
  if (lower === "takeaway" || lower === "take-away" || lower === "take away") return "takeaway";
  if (["delivery", "grab", "grabfood", "foodpanda", "shopee", "shopeefood"].includes(lower)) return "delivery";
  return "dine_in";
}

// ─── GET /api/sales/recommendations ────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const outletId = searchParams.get("outletId") || null;

    // Get date ranges: last 7 days and last 30 days
    const now = new Date();
    const mytNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayMYT = mytNow.toISOString().split("T")[0];

    const d7 = new Date(mytNow);
    d7.setDate(d7.getDate() - 6);
    const from7 = d7.toISOString().split("T")[0];

    const d30 = new Date(mytNow);
    d30.setDate(d30.getDate() - 29);
    const from30 = d30.toISOString().split("T")[0];

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

    // Fetch last 30 days of transactions
    const allTxns: StoreHubTransaction[] = [];
    for (const outlet of outlets) {
      if (!outlet.storehubId) continue;
      try {
        const from = new Date(from30 + "T00:00:00+08:00");
        const to = new Date(todayMYT + "T23:59:59+08:00");
        const txns = await getTransactions(outlet.storehubId, from, to);
        allTxns.push(...txns);
      } catch (err) {
        console.error(`[sales/recommendations] Failed to fetch for outlet ${outlet.name}:`, err);
      }
    }

    if (allTxns.length === 0) {
      return NextResponse.json({ recommendations: [], summary: "No sales data available." });
    }

    // ─── Aggregate data for AI analysis ─────────────────────────────

    // 1. Round performance (last 7 days vs last 30 days)
    type RoundStats = { revenue: number; orders: number; days: Set<string> };
    const roundStats7: Record<string, RoundStats> = {};
    const roundStats30: Record<string, RoundStats> = {};
    for (const r of ROUNDS) {
      roundStats7[r.key] = { revenue: 0, orders: 0, days: new Set() };
      roundStats30[r.key] = { revenue: 0, orders: 0, days: new Set() };
    }

    // 2. Product performance
    type ProductStats = { name: string; revenue: number; quantity: number; orders: number };
    const productStats: Record<string, ProductStats> = {};

    // 3. Channel breakdown
    const channelStats = { dine_in: { revenue: 0, orders: 0 }, takeaway: { revenue: 0, orders: 0 }, delivery: { revenue: 0, orders: 0 } };

    // 4. Daily totals for trend
    const dailyTotals: Record<string, { revenue: number; orders: number }> = {};

    for (const txn of allTxns) {
      const ts = txn.transactionTime || txn.completedAt || txn.createdAt;
      if (!ts) continue;

      const hour = getMYTHour(ts);
      const dateStr = getMYTDateStr(ts);
      const round = getRoundKey(hour);
      const channel = classifyChannel(txn.channel);

      // Daily
      if (!dailyTotals[dateStr]) dailyTotals[dateStr] = { revenue: 0, orders: 0 };
      dailyTotals[dateStr].revenue += txn.total;
      dailyTotals[dateStr].orders += 1;

      // Channel
      channelStats[channel].revenue += txn.total;
      channelStats[channel].orders += 1;

      // Round
      if (round) {
        roundStats30[round].revenue += txn.total;
        roundStats30[round].orders += 1;
        roundStats30[round].days.add(dateStr);
        if (dateStr >= from7) {
          roundStats7[round].revenue += txn.total;
          roundStats7[round].orders += 1;
          roundStats7[round].days.add(dateStr);
        }
      }

      // Products
      for (const item of txn.items || []) {
        const key = item.name.toLowerCase().trim();
        if (!productStats[key]) {
          productStats[key] = { name: item.name, revenue: 0, quantity: 0, orders: 0 };
        }
        productStats[key].revenue += item.total;
        productStats[key].quantity += item.quantity;
        productStats[key].orders += 1;
      }
    }

    // Build summary data for AI
    // Collect all dates seen for blended target
    const allDates7 = [...new Set(Object.values(roundStats7).flatMap(s => [...s.days]))].sort();
    const allDates30 = [...new Set(Object.values(roundStats30).flatMap(s => [...s.days]))].sort();

    const roundSummary = ROUNDS.map((r) => {
      const s7 = roundStats7[r.key];
      const s30 = roundStats30[r.key];
      const days7 = Math.max(s7.days.size, 1);
      const days30 = Math.max(s30.days.size, 1);
      const avgTarget7 = getAvgTarget(r.key, allDates7);
      const avgTarget30 = getAvgTarget(r.key, allDates30);
      return {
        round: r.label,
        timeRange: `${r.startH}:00-${r.endH}:00`,
        targetWeekday: ROUND_TARGETS[r.key].weekday,
        targetWeekend: ROUND_TARGETS[r.key].weekend,
        last7days: {
          avgDailyRevenue: Math.round(s7.revenue / days7),
          avgDailyOrders: Math.round((s7.orders / days7) * 10) / 10,
          totalRevenue: Math.round(s7.revenue),
          pctOfTarget: avgTarget7 > 0 ? Math.round((s7.revenue / days7 / avgTarget7) * 100) : 0,
        },
        last30days: {
          avgDailyRevenue: Math.round(s30.revenue / days30),
          avgDailyOrders: Math.round((s30.orders / days30) * 10) / 10,
          totalRevenue: Math.round(s30.revenue),
          pctOfTarget: avgTarget30 > 0 ? Math.round((s30.revenue / days30 / avgTarget30) * 100) : 0,
        },
      };
    });

    // Top products (sorted by revenue)
    const topProducts = Object.values(productStats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20)
      .map((p) => ({
        name: p.name,
        revenue: Math.round(p.revenue),
        quantity: p.quantity,
        avgPrice: p.orders > 0 ? Math.round((p.revenue / p.orders) * 100) / 100 : 0,
      }));

    // Bottom products
    const bottomProducts = Object.values(productStats)
      .filter((p) => p.orders >= 5) // at least 5 orders in 30 days
      .sort((a, b) => a.revenue - b.revenue)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        revenue: Math.round(p.revenue),
        quantity: p.quantity,
        avgPrice: p.orders > 0 ? Math.round((p.revenue / p.orders) * 100) / 100 : 0,
      }));

    const totalRevenue30 = allTxns.reduce((s, t) => s + t.total, 0);
    const totalOrders30 = allTxns.length;
    const aov30 = totalOrders30 > 0 ? Math.round((totalRevenue30 / totalOrders30) * 100) / 100 : 0;

    // Daily trend (last 7 days)
    const last7Dates = Object.keys(dailyTotals).sort().slice(-7);
    const dailyTrend = last7Dates.map((d) => ({
      date: d,
      revenue: Math.round(dailyTotals[d].revenue),
      orders: dailyTotals[d].orders,
    }));

    // ─── Call Claude for analysis ───────────────────────────────────

    const analysisPrompt = `You are a sales analyst for Celsius Coffee, a Malaysian specialty coffee chain. Analyze the following sales data and provide actionable recommendations.

DATA CONTEXT:
- Currency: Malaysian Ringgit (RM)
- Business: Specialty coffee chain
- Outlets: ${outlets.map((o) => o.name).join(", ")}
- Analysis period: Last 30 days (${from30} to ${todayMYT})

OVERALL METRICS (Last 30 days):
- Total Revenue: RM ${Math.round(totalRevenue30).toLocaleString()}
- Total Orders: ${totalOrders30.toLocaleString()}
- Average Order Value (AOV): RM ${aov30}

CHANNEL BREAKDOWN (Last 30 days):
- Dine-In: RM ${Math.round(channelStats.dine_in.revenue)} (${channelStats.dine_in.orders} orders)
- Takeaway: RM ${Math.round(channelStats.takeaway.revenue)} (${channelStats.takeaway.orders} orders)
- Delivery: RM ${Math.round(channelStats.delivery.revenue)} (${channelStats.delivery.orders} orders)

SALES BY ROUND (Daily target vs actual):
${roundSummary.map((r) => `${r.round} (${r.timeRange}): Target Weekday RM${r.targetWeekday} / Weekend RM${r.targetWeekend} | Last 7d avg: RM${r.last7days.avgDailyRevenue}/day (${r.last7days.pctOfTarget}%) | Last 30d avg: RM${r.last30days.avgDailyRevenue}/day (${r.last30days.pctOfTarget}%)`).join("\n")}

DAILY TREND (Last 7 days):
${dailyTrend.map((d) => `${d.date}: RM${d.revenue} (${d.orders} orders)`).join("\n")}

TOP 20 PRODUCTS BY REVENUE:
${topProducts.map((p, i) => `${i + 1}. ${p.name}: RM${p.revenue} (${p.quantity} units, avg RM${p.avgPrice})`).join("\n")}

LOWEST PERFORMING PRODUCTS (min 5 orders):
${bottomProducts.map((p) => `- ${p.name}: RM${p.revenue} (${p.quantity} units)`).join("\n")}

Please provide your analysis as a JSON array of recommendation objects. Each recommendation should have:
- "type": one of "opportunity", "warning", "insight", "action"
- "title": short title (max 60 chars)
- "description": 1-2 sentence explanation
- "impact": "high", "medium", or "low"
- "category": one of "round_performance", "product_mix", "aov", "channel", "trend"

Provide 5-8 recommendations focused on:
1. Which rounds are underperforming and what to do about it
2. Product opportunities (upsell, combo, promote)
3. AOV improvement tactics
4. Channel optimization (more takeaway? delivery promotions?)
5. Trend alerts (declining or growing)

Return ONLY valid JSON array, no markdown or explanation.`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: analysisPrompt }],
    });

    let recommendations: unknown[] = [];
    try {
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      // Parse JSON from response (handle potential markdown wrapping)
      const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      recommendations = JSON.parse(jsonStr);
    } catch {
      console.error("[sales/recommendations] Failed to parse AI response");
      recommendations = [];
    }

    return NextResponse.json({
      recommendations,
      summary: {
        totalRevenue30: Math.round(totalRevenue30),
        totalOrders30,
        aov30,
        analysisDate: todayMYT,
      },
    });
  } catch (err) {
    console.error("[sales/recommendations] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
