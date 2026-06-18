import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTransactions, type StoreHubTransaction } from "@/lib/storehub";
import {
  ROUNDS,
  isWeekend,
  getMYTHour,
  getMYTDateStr,
  getRound,
  type RoundKey,
} from "../../_lib/storehub-helpers";
import { getActiveTargets } from "../../_lib/targets";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LOOKBACK_DAYS = 28;

/**
 * POST /api/sales/targets/recompute
 *
 * Reads the last 28 days of StoreHub transactions, aggregates per-outlet
 * daily performance per (round × dayType), asks Claude to propose new
 * targets with reasoning, and saves them to the DB.
 *
 * Rule: targets only move UP (never regress) — no demoralizing cuts.
 */
export async function POST(_req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 1. Fetch outlets
    const outlets = await prisma.outlet.findMany({
      where: { storehubId: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true, storehubId: true },
    });
    if (outlets.length === 0) {
      return NextResponse.json({ error: "No outlets with StoreHub configured" }, { status: 404 });
    }

    // 2. Fetch last 28 days of transactions across all outlets
    const now = new Date();
    const mytNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayMYT = mytNow.toISOString().split("T")[0];
    const lookback = new Date(mytNow);
    lookback.setDate(lookback.getDate() - (LOOKBACK_DAYS - 1));
    const fromMYT = lookback.toISOString().split("T")[0];

    const allTxns: StoreHubTransaction[] = [];
    for (const o of outlets) {
      if (!o.storehubId) continue;
      try {
        const from = new Date(fromMYT + "T00:00:00+08:00");
        const to = new Date(todayMYT + "T23:59:59+08:00");
        const txns = await getTransactions(o.storehubId, from, to);
        allTxns.push(...txns);
      } catch (err) {
        console.error(`[targets/recompute] fetch failed for ${o.name}:`, err);
      }
    }

    if (allTxns.length === 0) {
      return NextResponse.json({ error: "No sales data in the last 28 days" }, { status: 404 });
    }

    // 3. Aggregate per-outlet per-day per-round
    // key: `${outletId}_${date}_${round}`  → { revenue, orders }
    type Cell = { revenue: number; orders: number };
    const perOutletDayRound = new Map<string, Cell>();

    for (const txn of allTxns) {
      const ts = txn.transactionTime || txn.completedAt || txn.createdAt;
      if (!ts) continue;
      const hour = getMYTHour(ts);
      const date = getMYTDateStr(ts);
      const round = getRound(hour);
      if (!round) continue;

      // Derive outletId from storeId on txn
      const outletIdVal = txn.storeId as string | undefined;
      const outlet = outletIdVal ? outlets.find((o) => o.storehubId === outletIdVal) : undefined;
      const outletKey = outlet?.id ?? "unknown";

      const key = `${outletKey}_${date}_${round}`;
      const cell = perOutletDayRound.get(key) ?? { revenue: 0, orders: 0 };
      cell.revenue += txn.total;
      cell.orders += 1;
      perOutletDayRound.set(key, cell);
    }

    // 4. Per (round, dayType): collect all per-outlet-day cells, compute stats
    type Agg = { revenues: number[]; orders: number[]; aovs: number[] };
    const empty = (): Agg => ({ revenues: [], orders: [], aovs: [] });
    const aggByKey: Record<RoundKey, { weekday: Agg; weekend: Agg }> = {} as never;
    for (const r of ROUNDS) aggByKey[r.key] = { weekday: empty(), weekend: empty() };

    for (const [key, cell] of perOutletDayRound.entries()) {
      const parts = key.split("_");
      const date = parts[1];
      const round = parts[2] as RoundKey;
      const dayType = isWeekend(date) ? "weekend" : "weekday";
      const aov = cell.orders > 0 ? cell.revenue / cell.orders : 0;
      aggByKey[round][dayType].revenues.push(cell.revenue);
      aggByKey[round][dayType].orders.push(cell.orders);
      aggByKey[round][dayType].aovs.push(aov);
    }

    const pct = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
      return sorted[idx];
    };
    const avg = (arr: number[]): number => (arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length);

    // Build trailing stats per round×daytype
    const trailing = ROUNDS.map((r) => {
      const row: Record<string, unknown> = { round: r.label, key: r.key, timeRange: `${r.startH}:00-${r.endH}:00` };
      for (const dt of ["weekday", "weekend"] as const) {
        const a = aggByKey[r.key][dt];
        row[`${dt}_sampleDays`] = a.revenues.length;
        row[`${dt}_avgRevenue`] = Math.round(avg(a.revenues));
        row[`${dt}_p50Revenue`] = Math.round(pct(a.revenues, 50));
        row[`${dt}_p75Revenue`] = Math.round(pct(a.revenues, 75));
        row[`${dt}_avgOrders`] = Math.round(avg(a.orders) * 10) / 10;
        row[`${dt}_avgAov`] = Math.round(avg(a.aovs) * 100) / 100;
      }
      return row;
    });

    // 5. Load current active targets (for "only go up" rule)
    const { targets: currentTargets } = await getActiveTargets();

    // 6. Prompt Claude
    const prompt = `You are setting progressive sales targets for Celsius Coffee.

Targets are PER-OUTLET, PER-DAY for each round (time band) × day type (weekday/weekend).
Baseline is trailing-28-days actual performance (aggregated per outlet per day, then averaged across outlets/days).

CURRENT ACTIVE TARGETS (per outlet per day):
${ROUNDS.map((r) => {
  const t = currentTargets[r.key];
  return `${r.label}: weekday RM${t.weekday.revenue} / ${t.weekday.orders} ord / RM${t.weekday.aov} AOV | weekend RM${t.weekend.revenue} / ${t.weekend.orders} ord / RM${t.weekend.aov} AOV`;
}).join("\n")}

TRAILING ${LOOKBACK_DAYS}-DAY ACTUALS (per outlet per day, aggregated across ${outlets.length} outlet${outlets.length !== 1 ? "s" : ""}):
${trailing.map((t) => {
  return `${t.round} (${t.timeRange}):
  Weekday: ${t.weekday_sampleDays} outlet-days sampled, avg RM${t.weekday_avgRevenue}/day, p50 RM${t.weekday_p50Revenue}, p75 RM${t.weekday_p75Revenue}, orders ${t.weekday_avgOrders}, AOV RM${t.weekday_avgAov}
  Weekend: ${t.weekend_sampleDays} outlet-days sampled, avg RM${t.weekend_avgRevenue}/day, p50 RM${t.weekend_p50Revenue}, p75 RM${t.weekend_p75Revenue}, orders ${t.weekend_avgOrders}, AOV RM${t.weekend_avgAov}`;
}).join("\n")}

Rules for setting new targets:
1. NEVER lower a target below its current value — targets only move UP. If trailing actuals are below current target, keep the current target.
2. If trailing actuals consistently meet or exceed current target (p50 ≥ current), stretch the target up. A reasonable stretch is somewhere between p50 and p75 of trailing actuals.
3. If trailing actuals are well above target (p50 > 1.3× current), push the target meaningfully higher — stretch closer to p75.
4. If sample size is very low (< 5 outlet-days), keep current target unchanged.
5. Orders and AOV targets should follow similar logic independently.
6. Round revenue to nearest RM25, orders to integer, AOV to 1 decimal.

Return ONLY a JSON object with this exact shape (no markdown, no wrapping):
{
  "reasoning": "1-3 sentences explaining the overall stretch strategy (e.g. 'Revenue trending 12% above trailing 30d, lunch p75 now RM2400 — stretching lunch weekday target from 450 to 500. Dinner still below target, holding.').",
  "targets": [
    { "round": "breakfast", "dayType": "weekday", "revenue": NNN, "orders": N, "aov": NN.N, "note": "optional short per-round note" },
    ... (14 entries total: 7 rounds × 2 day types)
  ]
}`;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: {
      reasoning: string;
      targets: Array<{ round: string; dayType: string; revenue: number; orders: number; aov: number; note?: string }>;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("[targets/recompute] Failed to parse AI response:", cleaned.slice(0, 500));
      return NextResponse.json({ error: "AI response could not be parsed" }, { status: 502 });
    }

    if (!parsed.targets || parsed.targets.length === 0) {
      return NextResponse.json({ error: "AI returned no targets" }, { status: 502 });
    }

    // 7. Enforce the "only go up" rule on the server side (defensive)
    const validDayTypes = new Set(["weekday", "weekend"]);
    const validRoundKeys = new Set(ROUNDS.map((r) => r.key));
    const finalRows = parsed.targets
      .filter((t) => validRoundKeys.has(t.round as RoundKey) && validDayTypes.has(t.dayType))
      .map((t) => {
        const current = currentTargets[t.round as RoundKey][t.dayType as "weekday" | "weekend"];
        return {
          roundKey: t.round,
          dayType: t.dayType,
          revenue: Math.max(t.revenue, current.revenue), // only up
          orders: Math.max(t.orders, current.orders),
          aov: Math.max(t.aov, current.aov),
          priorRevenue: current.revenue,
          note: t.note ?? null,
        };
      });

    // 8. Save — mark all existing active rows inactive, insert fresh active rows
    await prisma.$transaction(async (tx) => {
      await tx.salesTarget.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.salesTarget.createMany({
        data: finalRows.map((r) => ({
          roundKey: r.roundKey,
          dayType: r.dayType,
          revenue: r.revenue,
          orders: r.orders,
          aov: r.aov,
          source: "ai",
          reasoning: parsed.reasoning + (r.note ? ` | ${r.roundKey}/${r.dayType}: ${r.note}` : ""),
          priorRevenue: r.priorRevenue,
          isActive: true,
        })),
      });
    });

    return NextResponse.json({
      ok: true,
      reasoning: parsed.reasoning,
      targetsWritten: finalRows.length,
      sampleDays: LOOKBACK_DAYS,
    });
  } catch (err) {
    console.error("[targets/recompute] Error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}

