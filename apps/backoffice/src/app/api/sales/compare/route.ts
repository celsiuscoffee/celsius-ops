import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeProjection } from "@/lib/sales/projection";
import {
  ROUNDS,
  type RoundKey,
  getMYTHour,
  getMYTDateStr,
  getRound,
  getDateRange,
  emptyChannelData,
  addToChannel,
  roundChannel,
  roundChannelData,
} from "../_lib/storehub-helpers";
import { getUnifiedSalesForOutlet } from "../_lib/unified-sales";

// ─── GET /api/sales/compare ──────────────────────────────────────────────
// Compare multiple date ranges side by side.
// Query: ?periods=2026-04-07:2026-04-07,2026-03-31:2026-03-31&outletId=all

export async function GET(request: NextRequest) {
  try {
    const user = await getSession();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const outletId = searchParams.get("outletId") || null;
    const periodsParam = searchParams.get("periods") || "";

    // Parse periods: "from:to,from:to,..."
    const periodPairs = periodsParam
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [from, to] = p.split(":");
        return { from, to: to || from };
      });

    if (periodPairs.length === 0 || periodPairs.length > 8) {
      return NextResponse.json(
        { error: "Provide 1-8 periods as from:to pairs separated by commas" },
        { status: 400 },
      );
    }

    // Validate dates
    for (const pp of periodPairs) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pp.from) || !/^\d{4}-\d{2}-\d{2}$/.test(pp.to)) {
        return NextResponse.json({ error: `Invalid date format: ${pp.from}:${pp.to}` }, { status: 400 });
      }
    }

    // Fetch outlets
    const outletWhere = outletId && outletId !== "all"
      ? { id: outletId, storehubId: { not: null } }
      : { storehubId: { not: null }, status: "ACTIVE" as const };

    const outlets = await prisma.outlet.findMany({
      where: outletWhere,
      select: { id: true, name: true, storehubId: true, loyaltyOutletId: true, pickupStoreId: true, posNativeCutoverAt: true },
    });

    if (outlets.length === 0) {
      return NextResponse.json({ error: "No outlets with StoreHub configured" }, { status: 404 });
    }

    // Compute the global min/max date across all periods for smart merging
    let globalFrom = periodPairs[0].from;
    let globalTo = periodPairs[0].to;
    for (const pp of periodPairs) {
      if (pp.from < globalFrom) globalFrom = pp.from;
      if (pp.to > globalTo) globalTo = pp.to;
    }

    const warnings: string[] = [];

    // Period buckets to fill.
    const periodBuckets: { from: string; to: string; txns: { total: number; hour: number; dateStr: string; channel: "dine_in" | "takeaway" | "delivery" }[] }[] =
      periodPairs.map((pp) => ({ from: pp.from, to: pp.to, txns: [] }));

    // Fetch each outlet's sales once across the global span from the unified source
    // (StoreHub archive + live-today, POS-native, pickup app), then bucket per period.
    const globalFromDate = new Date(globalFrom + "T00:00:00+08:00");
    const globalToDate = new Date(globalTo + "T23:59:59+08:00");

    const outletResults = await Promise.allSettled(
      outlets.map((outlet) =>
        getUnifiedSalesForOutlet(
          {
            outletId: outlet.id,
            storehubStoreId: outlet.storehubId,
            loyaltyOutletId: outlet.loyaltyOutletId,
            pickupStoreId: outlet.pickupStoreId,
            cutoverAt: outlet.posNativeCutoverAt,
          },
          globalFromDate,
          globalToDate,
        ),
      ),
    );

    for (const result of outletResults) {
      if (result.status === "rejected") {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.error(`[sales/compare] Failed for outlet:`, msg);
        warnings.push(msg);
        continue;
      }
      for (const ev of result.value) {
        const dateStr = getMYTDateStr(ev.ts);
        const hour = getMYTHour(ev.ts);
        for (const bucket of periodBuckets) {
          if (dateStr >= bucket.from && dateStr <= bucket.to) {
            bucket.txns.push({ total: ev.total, hour, dateStr, channel: ev.channel });
          }
        }
      }
    }

    // Outlets we actually have data for — projection lib takes the IDs.
    const outletIdsForProjection = outlets.map((o) => o.id);

    // Build response for each period (async because projection compute hits the DB)
    const periods = await Promise.all(periodBuckets.map(async (bucket) => {
      const dates = getDateRange(bucket.from, bucket.to);

      // Summary
      let revenue = 0;
      let orders = 0;

      // Per-round data
      const roundData: Record<RoundKey, { revenue: number; orders: number; channels: ReturnType<typeof emptyChannelData> }> = {} as any;
      for (const r of ROUNDS) {
        roundData[r.key] = { revenue: 0, orders: 0, channels: emptyChannelData() };
      }

      // Daily totals
      const dailyMap: Record<string, { revenue: number; orders: number }> = {};
      // Daily per-round totals
      const dailyRoundMap: Record<string, Record<RoundKey, { revenue: number; orders: number }>> = {};
      for (const d of dates) {
        dailyMap[d] = { revenue: 0, orders: 0 };
        dailyRoundMap[d] = {} as Record<RoundKey, { revenue: number; orders: number }>;
        for (const r of ROUNDS) {
          dailyRoundMap[d][r.key] = { revenue: 0, orders: 0 };
        }
      }

      // Channel totals
      const channels = emptyChannelData();

      for (const txn of bucket.txns) {
        revenue += txn.total;
        orders += 1;

        addToChannel(channels, txn.channel, txn.total);

        if (dailyMap[txn.dateStr]) {
          dailyMap[txn.dateStr].revenue += txn.total;
          dailyMap[txn.dateStr].orders += 1;
        }

        const round = getRound(txn.hour);
        if (round && roundData[round]) {
          roundData[round].revenue += txn.total;
          roundData[round].orders += 1;
          addToChannel(roundData[round].channels, txn.channel, txn.total);

          if (dailyRoundMap[txn.dateStr]?.[round]) {
            dailyRoundMap[txn.dateStr][round].revenue += txn.total;
            dailyRoundMap[txn.dateStr][round].orders += 1;
          }
        }
      }

      // Hourly buckets (for the accumulative overlay chart). For single-day
      // periods the client renders these as a cumulative line by hour; for
      // multi-day periods it falls back to a daily cumulative line.
      const hourly = Array.from({ length: 24 }, () => ({ revenue: 0, orders: 0 }));
      for (const txn of bucket.txns) {
        if (txn.hour >= 0 && txn.hour <= 23) {
          hourly[txn.hour].revenue += txn.total;
          hourly[txn.hour].orders += 1;
        }
      }

      // Format label
      const label = formatPeriodLabel(bucket.from, bucket.to);

      // Projection — only computed when today falls inside the period.
      // Reads from local SalesTransaction (last 28 days + same-period
      // last month) so it's a fast addition, not a StoreHub round-trip.
      // Returns null for past/future periods; client falls back to
      // hiding the projection card in that case.
      const projection = await computeProjection({
        from: bucket.from,
        to: bucket.to,
        outletIds: outletIdsForProjection,
      }).catch((err) => {
        console.warn(`[sales/compare] projection compute failed for ${bucket.from}–${bucket.to}:`, err);
        return null;
      });

      return {
        from: bucket.from,
        to: bucket.to,
        label,
        projection,
        summary: {
          revenue: Math.round(revenue * 100) / 100,
          orders,
          aov: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0,
        },
        rounds: ROUNDS.map((r) => {
          const rd = roundData[r.key];
          const ch = roundChannelData(rd.channels);
          return {
            key: r.key,
            label: r.label,
            revenue: Math.round(rd.revenue * 100) / 100,
            orders: rd.orders,
            aov: rd.orders > 0 ? Math.round((rd.revenue / rd.orders) * 100) / 100 : 0,
            channels: ch,
          };
        }),
        channels: roundChannelData(channels),
        hourly: hourly.map((b, h) => ({
          hour: h,
          revenue: Math.round(b.revenue * 100) / 100,
          orders: b.orders,
        })),
        dailyTotals: dates.map((d) => ({
          date: d,
          revenue: Math.round((dailyMap[d]?.revenue || 0) * 100) / 100,
          orders: dailyMap[d]?.orders || 0,
          rounds: ROUNDS.map((r) => ({
            key: r.key,
            revenue: Math.round((dailyRoundMap[d]?.[r.key]?.revenue || 0) * 100) / 100,
            orders: dailyRoundMap[d]?.[r.key]?.orders || 0,
          })),
        })),
      };
    }));

    // Outlets for filter dropdown
    const allOutlets = await prisma.outlet.findMany({
      where: { storehubId: { not: null }, status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      periods,
      availableOutlets: allOutlets,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (err) {
    console.error("[sales/compare] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function formatPeriodLabel(from: string, to: string): string {
  const f = new Date(from + "T12:00:00+08:00");
  const t = new Date(to + "T12:00:00+08:00");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  if (from === to) {
    // Single day: "Mon 7 Apr"
    return `${days[f.getDay()]} ${f.getDate()} ${months[f.getMonth()]}`;
  }

  // Check if it's a full month
  const fDate = f.getDate();
  const tDate = t.getDate();
  const lastDay = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  if (fDate === 1 && tDate === lastDay && f.getMonth() === t.getMonth()) {
    return `${months[f.getMonth()]} ${f.getFullYear()}`;
  }

  // Range: "7-13 Apr" or "28 Mar - 3 Apr"
  if (f.getMonth() === t.getMonth()) {
    return `${f.getDate()}-${t.getDate()} ${months[f.getMonth()]}`;
  }
  return `${f.getDate()} ${months[f.getMonth()]} - ${t.getDate()} ${months[t.getMonth()]}`;
}
